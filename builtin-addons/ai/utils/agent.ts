import type {} from '@firedragon/shared/types/extensions';
import { browser } from 'wxt/browser';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
    id: string;
    role: ChatRole;
    content: string;
    createdAt: number;
}

export interface AgentConfig {
    provider?: string;
    endpoint: string;
    model?: string;
    token?: string;
}

export interface AgentConfigResult {
    config: AgentConfig | null;
    path: string | null;
    error?: string;
}

export interface ChatTransport {
    send(messages: ChatMessage[], options: { signal: AbortSignal }): AsyncGenerator<string>;
}

export async function loadAgentConfig(): Promise<AgentConfigResult> {
    let raw: string | null;
    try {
        raw = await browser.firedragon.getAgentsConfig();
    } catch (error) {
        return { config: null, path: null, error: String(error) };
    }
    if (!raw) {
        return { config: null, path: null, error: 'agents.json não encontrado' };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return { config: null, path: null, error: `agents.json inválido: ${error}` };
    }

    const file = parsed?.config;
    const name = file?.default ?? (file?.agents ? Object.keys(file.agents)[0] : null);
    const agent = name && file?.agents ? file.agents[name] : null;
    if (!agent?.endpoint) {
        return {
            config: null,
            path: parsed?.path ?? null,
            error: parsed?.error ?? 'endpoint do agente não configurado',
        };
    }

    return {
        config: {
            provider: agent.provider,
            endpoint: agent.endpoint,
            model: agent.model,
            token: agent.token,
        },
        path: parsed.path ?? null,
    };
}

export function createNotConfiguredTransport(message: string): ChatTransport {
    return {
        async *send(_messages, { signal }) {
            for (const word of message.split(' ')) {
                if (signal.aborted) {
                    return;
                }
                await wait(18, signal);
                yield `${word} `;
            }
        },
    };
}

export function createCloudflareTransport(agent: AgentConfig): ChatTransport {
    return {
        async *send(messages, { signal }) {
            const headers: Record<string, string> = {
                'content-type': 'application/json',
            };
            if (agent.token) {
                headers.authorization = `Bearer ${agent.token}`;
            }

            const response = await fetch(agent.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    messages: messages.map(({ role, content }) => ({ role, content })),
                }),
                signal,
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                throw new Error(`Agent HTTP ${response.status}: ${detail.slice(0, 300)}`);
            }
            if (!response.body) {
                throw new Error('Agent response has no body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const parse = function* (line: string): Generator<string> {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) {
                    return;
                }
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === '[DONE]') {
                    return;
                }
                let data: any;
                try {
                    data = JSON.parse(payload);
                } catch {
                    return;
                }
                const text = data.response ?? data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content;
                if (text) {
                    yield text;
                }
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    let index: number;
                    while ((index = buffer.indexOf('\n')) !== -1) {
                        const line = buffer.slice(0, index);
                        buffer = buffer.slice(index + 1);
                        yield* parse(line);
                    }
                }
                if (buffer) {
                    yield* parse(buffer);
                }
            } finally {
                reader.releaseLock();
            }
        },
    };
}

function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                resolve();
            },
            { once: true },
        );
    });
}
