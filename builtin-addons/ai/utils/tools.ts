import { browser } from 'wxt/browser';

export interface AgentTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
    type: 'object',
    properties,
    required,
});

const number = { type: 'number' };
const string = { type: 'string' };

export const AGENT_TOOLS: AgentTool[] = [
    {
        type: 'function',
        function: {
            name: 'list_tabs',
            description: 'Lista as abas abertas no navegador com id, título, URL e qual está ativa.',
            parameters: object(),
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_page',
            description:
                'Lê a aba ativa: URL, título, texto, posição de scroll e elementos interativos com refs. Use os refs em click/type e find_text para localizar trechos.',
            parameters: object({ tab_id: number }),
        },
    },
    {
        type: 'function',
        function: {
            name: 'find_text',
            description:
                'Procura um texto na aba, rola até a primeira ocorrência e retorna até 5 trechos com contexto. Use antes de rolar cegamente em documentos longos.',
            parameters: object({ query: string, tab_id: number }, ['query']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'navigate',
            description: 'Navega a aba ativa (ou tab_id) para uma URL http/https.',
            parameters: object({ url: string, tab_id: number }, ['url']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'click',
            description: 'Clica em um elemento da aba usando o ref retornado por get_page.',
            parameters: object({ ref: string, tab_id: number }, ['ref']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'type',
            description:
                'Digita em um campo da aba usando o ref retornado por get_page. Use submit=true para enviar o formulário ou pressionar Enter.',
            parameters: object({ ref: string, text: string, submit: { type: 'boolean' }, tab_id: number }, [
                'ref',
                'text',
            ]),
        },
    },
    {
        type: 'function',
        function: {
            name: 'scroll',
            description:
                'Rola a página ou o container rolável principal (funciona em docs com div overflow). Retorna posição, altura e se chegou ao fim. Use to=top/bottom para ir direto.',
            parameters: object(
                {
                    direction: { type: 'string', enum: ['up', 'down'] },
                    to: { type: 'string', enum: ['top', 'bottom'] },
                    amount: number,
                    tab_id: number,
                },
                [],
            ),
        },
    },
    {
        type: 'function',
        function: {
            name: 'go_back',
            description: 'Volta no histórico da aba.',
            parameters: object({ tab_id: number }),
        },
    },
    {
        type: 'function',
        function: {
            name: 'go_forward',
            description: 'Avança no histórico da aba.',
            parameters: object({ tab_id: number }),
        },
    },
];

function extensionBase() {
    try {
        return browser.runtime.getURL('');
    } catch {
        return 'moz-extension://';
    }
}

async function resolveTab(tabId?: number) {
    if (typeof tabId === 'number') {
        return await browser.tabs.get(tabId);
    }

    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (active?.id && !active.url?.startsWith(extensionBase())) {
        return active;
    }

    const tabs = await browser.tabs.query({ currentWindow: true });
    const content = tabs.find((tab) => tab.id && !tab.url?.startsWith(extensionBase()));
    if (!content?.id) {
        throw new Error('Nenhuma aba de conteúdo encontrada');
    }
    return content;
}

async function execute(tabId: number, code: string): Promise<any> {
    const results = await browser.tabs.executeScript(tabId, {
        code,
        runAt: 'document_idle',
    });
    return results?.[0];
}

function pageSnapshot() {
    const selector =
        'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"]';
    const nodes = Array.from(document.querySelectorAll(selector))
        .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (!style) {
                return false;
            }
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                style.pointerEvents !== 'none'
            );
        })
        .slice(0, 120);

    const elements = nodes.map((element, index) => {
        const ref = `g${index + 1}`;
        element.setAttribute('data-goatai-ref', ref);
        const text = (
            (element as HTMLElement).innerText ||
            (element instanceof HTMLInputElement ? element.value : '') ||
            element.getAttribute('aria-label') ||
            element.getAttribute('placeholder') ||
            element.getAttribute('title') ||
            ''
        )
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 140);
        return {
            ref,
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute('type') || undefined,
            role: element.getAttribute('role') || undefined,
            text,
            href: element instanceof HTMLAnchorElement ? element.href : undefined,
            name: element.getAttribute('name') || undefined,
        };
    });

    const text = (document.body?.innerText || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 9000);

    const scroller = document.scrollingElement || document.documentElement;
    return {
        url: location.href,
        title: document.title,
        selected: (window.getSelection()?.toString() || '').slice(0, 2000),
        scroll: {
            y: Math.round(scroller.scrollTop),
            height: scroller.scrollHeight,
            viewport: scroller.clientHeight,
            atTop: scroller.scrollTop <= 1,
            atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
        },
        text,
        elements,
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabLoad(tabId: number, timeout = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const current = await browser.tabs.get(tabId);
            if (current.status === 'complete') {
                await sleep(200);
                return;
            }
        } catch {
            return;
        }
        await sleep(150);
    }
}

async function waitAfterAction(previousTabId: number) {
    await sleep(250);
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    const target = active?.id && active.id !== previousTabId ? active.id : previousTabId;
    await waitForTabLoad(target);
}

function scrollPage(direction: string, to: string, amount: number) {
    const candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        ...document.querySelectorAll('main, article, section, div'),
    ];
    let best: Element | null = null;
    let bestScore = -1;
    for (const element of candidates) {
        if (!element) {
            continue;
        }
        const style = getComputedStyle(element);
        const isRoot = element === document.scrollingElement || element === document.documentElement;
        if (!isRoot && !/(auto|scroll|overlay)/.test(style.overflowY)) {
            continue;
        }
        if (element.scrollHeight <= element.clientHeight + 4) {
            continue;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 80) {
            continue;
        }
        const score = element.clientHeight * 1000 + Math.min(element.scrollHeight, 1000000);
        if (score > bestScore) {
            bestScore = score;
            best = element;
        }
    }
    if (!best) {
        return { ok: false, error: 'no_scrollable_container' };
    }
    const before = best.scrollTop;
    if (to === 'bottom') {
        best.scrollTop = best.scrollHeight;
    } else if (to === 'top') {
        best.scrollTop = 0;
    } else {
        best.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'auto' });
    }
    const after = best.scrollTop;
    const className =
        typeof best.className === 'string' && best.className.trim()
            ? `.${best.className.trim().split(/\s+/).slice(0, 2).join('.')}`
            : '';
    return {
        ok: true,
        direction,
        to: to || undefined,
        container:
            best === document.scrollingElement
                ? 'window'
                : `${best.tagName.toLowerCase()}${best.id ? `#${best.id}` : ''}${className}`,
        before: Math.round(before),
        after: Math.round(after),
        height: best.scrollHeight,
        viewport: best.clientHeight,
        atTop: after <= 1,
        atBottom: after + best.clientHeight >= best.scrollHeight - 2,
    };
}

function findText(query: string) {
    const needle = String(query || '')
        .toLowerCase()
        .slice(0, 200);
    if (!needle) {
        return { found: false, error: 'empty_query', matches: [] };
    }
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const matches: { snippet: string; tag: string }[] = [];
    let first: Element | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node.nodeValue || '';
        const index = text.toLowerCase().indexOf(needle);
        if (index === -1) {
            continue;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,svg')) {
            continue;
        }
        const snippet = text
            .slice(Math.max(0, index - 100), index + needle.length + 180)
            .replace(/\s+/g, ' ')
            .trim();
        matches.push({ snippet, tag: parent.tagName.toLowerCase() });
        if (!first) {
            first = parent;
        }
        if (matches.length >= 5) {
            break;
        }
    }
    if (first) {
        first.scrollIntoView({ block: 'center', inline: 'center' });
    }
    return {
        found: matches.length > 0,
        query,
        count: matches.length,
        matches,
        url: location.href,
        title: document.title,
    };
}

export async function runTool(name: string, args: Record<string, any>): Promise<unknown> {
    if (name === 'list_tabs') {
        const tabs = await browser.tabs.query({});
        return tabs.slice(0, 50).map(({ id, title, url, active, pinned, audible }) => ({
            id,
            title,
            url,
            active,
            pinned,
            audible,
        }));
    }

    const tab = await resolveTab(typeof args.tab_id === 'number' ? args.tab_id : undefined);
    if (!tab.id) {
        throw new Error('Aba sem id');
    }

    switch (name) {
        case 'get_page':
            return await execute(tab.id, `(${pageSnapshot.toString()})()`);

        case 'find_text':
            return await execute(tab.id, `(${findText.toString()})(${JSON.stringify(String(args.query ?? ''))})`);

        case 'navigate': {
            const url = new URL(String(args.url));
            if (!['http:', 'https:'].includes(url.protocol)) {
                throw new Error('Apenas URLs http/https são permitidas');
            }
            await browser.tabs.update(tab.id, { url: url.href });
            await waitAfterAction(tab.id);
            return { ok: true, url: url.href };
        }

        case 'click': {
            const ref = String(args.ref);
            if (!/^g\d+$/.test(ref)) {
                throw new Error('ref inválido');
            }
            const result = await execute(
                tab.id,
                `(() => {
                    const el = document.querySelector('[data-goatai-ref="${ref}"]');
                    if (!el) return { ok: false, error: 'element_not_found' };
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                    el.focus?.();
                    el.click();
                    return { ok: true, tag: el.tagName.toLowerCase() };
                })()`,
            );
            await waitAfterAction(tab.id);
            return result;
        }

        case 'type': {
            const ref = String(args.ref);
            if (!/^g\d+$/.test(ref)) {
                throw new Error('ref inválido');
            }
            const text = JSON.stringify(String(args.text ?? ''));
            const submit = args.submit ? 'true' : 'false';
            return await execute(
                tab.id,
                `(() => {
                    const el = document.querySelector('[data-goatai-ref="${ref}"]');
                    if (!el) return { ok: false, error: 'element_not_found' };
                    el.focus();
                    const proto = el instanceof HTMLTextAreaElement
                        ? HTMLTextAreaElement.prototype
                        : HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (setter) setter.call(el, ${text});
                    else el.value = ${text};
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    if (${submit}) {
                        const form = el.form || el.closest('form');
                        if (form?.requestSubmit) form.requestSubmit();
                        else if (form) form.submit();
                        else el.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                        }));
                    }
                    return { ok: true };
                })()`,
            );
            if (args.submit) {
                await waitAfterAction(tab.id);
            }
            return { ok: true };
        }

        case 'scroll': {
            const amount = Math.min(Math.max(Number(args.amount) || 600, 50), 5000);
            const direction = String(args.direction ?? 'down');
            const to = ['top', 'bottom'].includes(String(args.to)) ? String(args.to) : '';
            const result = await execute(
                tab.id,
                `(${scrollPage.toString()})(${JSON.stringify(direction)}, ${JSON.stringify(to)}, ${amount})`,
            );
            await sleep(300);
            return result;
        }

        case 'go_back':
            await browser.tabs.goBack(tab.id);
            await waitAfterAction(tab.id);
            return { ok: true };

        case 'go_forward':
            await browser.tabs.goForward(tab.id);
            await waitAfterAction(tab.id);
            return { ok: true };

        default:
            throw new Error(`Ferramenta desconhecida: ${name}`);
    }
}
