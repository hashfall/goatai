export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
    id: string;
    role: ChatRole;
    content: string;
    createdAt: number;
}

export interface ChatTransport {
    /**
     * Sends the conversation to the agent and yields the reply as it streams in.
     *
     * TODO: Replace this stub with the Cloudflare Agents transport once the
     * `agents.json` profile configuration is wired up.
     */
    send(messages: ChatMessage[], options: { signal: AbortSignal }): AsyncGenerator<string>;
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

export function createTransport(options: { notConfiguredMessage: string }): ChatTransport {
    return {
        async *send(_messages, { signal }) {
            const words = options.notConfiguredMessage.split(' ');
            for (const word of words) {
                if (signal.aborted) {
                    return;
                }
                await wait(18, signal);
                yield `${word} `;
            }
        },
    };
}
