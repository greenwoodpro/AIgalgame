const API_BASES = {
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    modelscope: 'https://api-inference.modelscope.cn/v1',
    nvidia: 'https://integrate.api.nvidia.com/v1',
};

function getApiKey(env, provider) {
    const map = {
        zhipu: env.ZHIPU_API_KEY,
        modelscope: env.MODELSCOPE_API_KEY,
        nvidia: env.NVIDIA_API_KEY,
    };
    return map[provider] || null;
}

const ALLOWED_ORIGINS = ['https://galai.dpdns.org', 'https://aigalgame.pages.dev', 'http://localhost:3000', 'http://localhost:5500'];

function getCorsHeaders(origin) {
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ModelScope-Async-Mode, X-ModelScope-Task-Type',
        'Access-Control-Expose-Headers': 'modelscope-ratelimit-requests-limit, modelscope-ratelimit-requests-remaining, modelscope-ratelimit-model-requests-limit, modelscope-ratelimit-model-requests-remaining',
    };
}

function errorResponse(message, status = 400, origin) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
    });
}

async function proxyApi(request, env, provider, apiPath) {
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin);
    const apiKey = getApiKey(env, provider);
    const baseUrl = API_BASES[provider];
    if (!apiKey || !baseUrl) {
        return errorResponse('服务不可用', 404, origin);
    }

    if (apiPath.includes('..')) {
        return errorResponse('无效的API路径', 400, origin);
    }

    const targetUrl = `${baseUrl}/${apiPath}`;

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await request.arrayBuffer();
    }

    const proxyHeaders = new Headers();
    proxyHeaders.set('Authorization', `Bearer ${apiKey}`);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        proxyHeaders.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    }
    if (provider === 'modelscope') {
        const asyncMode = request.headers.get('X-ModelScope-Async-Mode');
        const taskType = request.headers.get('X-ModelScope-Task-Type');
        if (asyncMode) proxyHeaders.set('X-ModelScope-Async-Mode', asyncMode);
        if (taskType) proxyHeaders.set('X-ModelScope-Task-Type', taskType);
    }

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
            response.body.pipeTo(writable).catch((err) => {
                console.error('Stream pipe error:', err);
                try { writable.close(); } catch {}
            });
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

        const respBody = await response.text();

        const newHeaders = new Headers();
        newHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

        return new Response(respBody, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } catch (e) {
        console.error(`Proxy error [${provider}/${apiPath}]:`, e.message);
        return errorResponse('上游API请求失败', 502, origin);
    }
}

export async function onRequestOptions(context) {
    const origin = context.request.headers.get('Origin') || '';
    return new Response(null, {
        headers: {
            ...getCorsHeaders(origin),
            'Access-Control-Max-Age': '86400',
        },
    });
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return onRequestOptions();
    }

    const pathPart = url.pathname.replace(/^\/api\/?/, '');
    const parts = pathPart.split('/');
    const provider = parts[0];
    const apiPath = parts.slice(1).join('/') + url.search;

    if (!provider || !API_BASES[provider]) {
        return errorResponse(`Unknown provider: ${provider}`);
    }

    return proxyApi(request, env, provider, apiPath);
}
