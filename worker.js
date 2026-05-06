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

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'modelscope-ratelimit-requests-limit, modelscope-ratelimit-requests-remaining, modelscope-ratelimit-model-requests-limit, modelscope-ratelimit-model-requests-remaining',
};

function errorResponse(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

async function proxyApi(request, env, provider, apiPath) {
    const apiKey = getApiKey(env, provider);
    const baseUrl = API_BASES[provider];
    if (!apiKey || !baseUrl) {
        return errorResponse(`Provider ${provider} not configured: ${!apiKey ? 'API key missing' : 'base URL missing'}`, 500);
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
            response.body.pipeTo(writable).catch(() => {});
            return new Response(readable, {
                status: response.status,
                statusText: response.statusText,
                headers: {
                    'Content-Type': 'text/event-stream;charset=UTF-8',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    ...CORS_HEADERS,
                },
            });
        }

        const respBody = await response.text();

        const newHeaders = new Headers();
        newHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/json');
        Object.entries(CORS_HEADERS).forEach(([k, v]) => newHeaders.set(k, v));

        return new Response(respBody, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } catch (e) {
        return errorResponse(e.message, 502);
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    ...CORS_HEADERS,
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        if (url.pathname.startsWith('/api/')) {
            const pathPart = url.pathname.replace(/^\/api\/?/, '');
            const parts = pathPart.split('/');
            const provider = parts[0];
            const apiPath = parts.slice(1).join('/') + url.search;

            if (!provider || !API_BASES[provider]) {
                return errorResponse(`Unknown provider: ${provider}`);
            }

            return proxyApi(request, env, provider, apiPath);
        }

        return new Response('Not Found', { status: 404 });
    },
};
