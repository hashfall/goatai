import type {} from '@firedragon/shared/types/extensions';
import { browser } from 'wxt/browser';

import { AGENT_TOOLS, runTool } from '@/utils/tools';

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

export function createAgentTransport(agent: AgentConfig, system = ''): ChatTransport {
    return {
        async *send(messages, { signal }) {
            const headers: Record<string, string> = {
                'content-type': 'application/json',
            };
            if (agent.token) {
                headers.authorization = `Bearer ${agent.token}`;
            }

            const history: any[] = messages.map(({ role, content }) => ({ role, content }));

            const request = async (useTools: boolean, extraSystem = '') => {
                const response = await fetch(agent.endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        messages: history,
                        system: extraSystem ? `${system}\n\n${extraSystem}` : system,
                        model: agent.model,
                        ...(useTools ? { tools: AGENT_TOOLS } : {}),
                        stream: false,
                    }),
                    signal,
                });

                if (!response.ok) {
                    const detail = await response.text().catch(() => '');
                    throw new Error(`Agent HTTP ${response.status}: ${detail.slice(0, 300)}`);
                }

                const payload: any = await response.json();
                const message =
                    payload?.message ??
                    payload?.result?.choices?.[0]?.message ??
                    payload?.choices?.[0]?.message ??
                    (payload?.response ? { role: 'assistant', content: payload.response } : null);
                if (!message) {
                    throw new Error('Agent returned an invalid response');
                }
                return message;
            };

            const MAX_STEPS = 16;
            for (let step = 0; step < MAX_STEPS; step++) {
                if (signal.aborted) {
                    return;
                }

                const remaining = MAX_STEPS - step;
                const useTools = remaining > 1;
                let extraSystem = '';
                if (!useTools) {
                    extraSystem =
                        'Você atingiu o limite de passos de ferramentas. Não chame mais ferramentas; responda com o que já descobriu e diga o que ficou pendente.';
                } else if (remaining <= 4) {
                    extraSystem = `Restam ${remaining} passos. Evite repetir a mesma ferramenta com os mesmos argumentos e conclua assim que possível.`;
                }

                const message = await request(useTools, extraSystem);
                const toolCalls: any[] = message.tool_calls ?? message.toolCalls ?? [];

                if (useTools && toolCalls.length > 0) {
                    history.push({
                        role: 'assistant',
                        content: message.content ?? '',
                        tool_calls: toolCalls,
                    });
                    for (const call of toolCalls) {
                        const name = call.function?.name ?? call.name;
                        let args: Record<string, any> = {};
                        let result: unknown;
                        try {
                            const raw = call.function?.arguments ?? call.arguments ?? '{}';
                            args = typeof raw === 'string' ? JSON.parse(raw) : raw;
                            result = await runTool(name, args);
                        } catch (error) {
                            console.error('[Goatai] tool failed', name, error);
                            result = { ok: false, error: String(error) };
                        }
                        history.push({
                            role: 'tool',
                            tool_call_id: call.id,
                            name,
                            content: JSON.stringify(result).slice(0, 20000),
                        });
                    }
                    continue;
                }

                let content = String(message.content ?? message.response ?? '').trim();
                if (!content && useTools) {
                    const fallback = await request(
                        false,
                        'Responda agora ao usuário usando o que já descobriu. Não chame ferramentas.',
                    );
                    content = String(fallback.content ?? fallback.response ?? '').trim();
                }
                if (!content) {
                    throw new Error('O agente não retornou uma resposta final');
                }
                for (let index = 0; index < content.length; index += 24) {
                    if (signal.aborted) {
                        return;
                    }
                    yield content.slice(index, index + 24);
                    await wait(8, signal);
                }
                return;
            }

            throw new Error('O agente atingiu o limite de passos de ferramentas');
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
