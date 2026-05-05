const API_BASES = {
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    modelscope: 'https://api-inference.modelscope.cn/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
    cerebras: 'https://api.cerebras.ai/v1',
};

const STATIC_TYPES = {
    html: 'text/html;charset=UTF-8',
    css: 'text/css;charset=UTF-8',
    js: 'application/javascript;charset=UTF-8',
    json: 'application/json;charset=UTF-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
};

function getApiKey(env, provider) {
    const map = {
        zhipu: env.ZHIPU_API_KEY,
        modelscope: env.MODELSCOPE_API_KEY,
        nvidia: env.NVIDIA_API_KEY,
        cerebras: env.CEREBRAS_API_KEY,
    };
    return map[provider] || null;
}

async function serveStatic(path, env) {
    if (path === '/' || path === '') path = '/index.html';
    const key = path.startsWith('/') ? path.slice(1) : path;
    if (!env.SITE_BUCKET) return null;
    const object = await env.SITE_BUCKET.get(key);
    if (!object) return null;
    const ext = key.split('.').pop().toLowerCase();
    const contentType = STATIC_TYPES[ext] || 'application/octet-stream';
    return new Response(object.body, {
        headers: {
            'Content-Type': contentType,
            'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=86400',
        },
    });
}

async function proxyApi(request, env, provider, apiPath) {
    const apiKey = getApiKey(env, provider);
    const baseUrl = API_BASES[provider];
    if (!apiKey || !baseUrl) {
        return new Response(JSON.stringify({ error: `Provider ${provider} not configured` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    const targetUrl = `${baseUrl}/${apiPath}`;
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Expose-Headers': 'modelscope-ratelimit-requests-limit, modelscope-ratelimit-requests-remaining, modelscope-ratelimit-model-requests-limit, modelscope-ratelimit-model-requests-remaining',
    };

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
    }

    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set('Authorization', `Bearer ${apiKey}`);
    proxyHeaders.delete('host');

    try {
        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: proxyHeaders,
            body: body ? body : undefined,
        });

        const response = await fetch(proxyRequest);

        const isStream = response.headers.get('content-type')?.includes('text/event-stream');

        if (isStream) {
            const { readable, writable } = new TransformStream();
            response.body.pipeTo(writable).catch(() => {});
            return new Response(readable, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    'Content-Type': 'text/event-stream;charset=UTF-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...corsHeaders,
                },
            });
        }

        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        if (url.pathname.startsWith('/api/')) {
            const parts = url.pathname.replace('/api/', '').split('/');
            const provider = parts[0];
            const apiPath = parts.slice(1).join('/') + url.search;
            return proxyApi(request, env, provider, apiPath);
        }

        let response = await serveStatic(url.pathname, env);
        if (!response) {
            response = await serveStatic('/index.html', env);
        }
        if (!response) {
            response = new Response('Not Found', { status: 404 });
        }
        return response;
    },
};
