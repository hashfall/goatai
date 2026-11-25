const MODEL = '@cf/zai-org/glm-4.7-flash';

const SYSTEM_PROMPT = `Você é o Goatai, o assistente de IA integrado ao navegador do usuário.
Responda no idioma do usuário (padrão: português do Brasil).
Seja direto, útil e honesto sobre o que você consegue ou não fazer.
Você ainda não tem ferramentas para agir na página; quando o usuário pedir uma ação no navegador,
explique que a capacidade de navegar e agir será habilitada nas próximas etapas.`;

const MAX_MESSAGES = 40;
const MAX_CONTENT = 20000;

function cors(response) {
    response.headers.set('access-control-allow-origin', '*');
    response.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.headers.set('access-control-allow-headers', 'authorization, content-type');
    response.headers.set('access-control-max-age', '86400');
    return response;
}

function json(data, status = 200) {
    return cors(
        new Response(JSON.stringify(data), {
            status,
            headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
    );
}

function authorized(request, env) {
    if (!env.AGENT_TOKEN) {
        return false;
    }
    const header = request.headers.get('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '').trim() || request.headers.get('x-goatai-token');
    return token === env.AGENT_TOKEN;
}

function sanitize(messages) {
    if (!Array.isArray(messages)) {
        return null;
    }
    const cleaned = messages
        .slice(-MAX_MESSAGES)
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({
            role: message.role,
            content: String(message.content ?? '').slice(0, MAX_CONTENT),
        }))
        .filter((message) => message.content.length > 0);
    return cleaned.length > 0 ? cleaned : null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return cors(new Response(null, { status: 204 }));
        }

        if (request.method === 'GET' && url.pathname === '/health') {
            return json({ ok: true, model: env.MODEL ?? MODEL });
        }

        if (request.method !== 'POST' || url.pathname !== '/chat') {
            return json({ error: 'not_found' }, 404);
        }

        if (!authorized(request, env)) {
            return json({ error: 'unauthorized' }, 401);
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'invalid_json' }, 400);
        }

        const messages = sanitize(body?.messages);
        if (!messages) {
            return json({ error: 'invalid_messages' }, 400);
        }

        let stream;
        try {
            stream = await env.AI.run(env.MODEL ?? MODEL, {
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
                stream: true,
                max_tokens: 2048,
            });
        } catch (error) {
            return json({ error: 'ai_error', message: error instanceof Error ? error.message : String(error) }, 502);
        }

        return cors(
            new Response(stream, {
                headers: {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache, no-transform',
                    'x-accel-buffering': 'no',
                },
            }),
        );
    },
};
