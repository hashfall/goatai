import { browser } from 'wxt/browser';

import { loadPdf, searchPdf } from '@/utils/pdf';

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
                'Lê a aba ativa, incluindo todos os frames: URL, título, texto, posição de scroll e elementos interativos com refs (frame:gN). Use os refs em click/type/hover e find_text para localizar trechos.',
            parameters: object({ tab_id: number }),
        },
    },
    {
        type: 'function',
        function: {
            name: 'find_text',
            description:
                'Procura um texto em todos os frames, rola até a primeira ocorrência e retorna até 5 trechos com contexto por frame. Use antes de rolar cegamente em documentos longos.',
            parameters: object({ query: string, tab_id: number }, ['query']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_pdf',
            description:
                'Baixa e extrai o texto de um PDF, inclusive links Google Drive /file/d/.../view. Use query para procurar datas/termos e receber páginas e trechos; use page para ler uma página específica; sem query/page retorna o texto (limitado). Em PDFs, prefira read_pdf em vez de scroll. Se houver várias ocorrências, compare todas e use a mais recente quando a pergunta for sobre o 2º semestre/atualidade.',
            parameters: object({ url: string, query: string, page: number, tab_id: number }),
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
            description:
                'Clica em um elemento da aba usando o ref retornado por get_page (inclusive frame:gN). Se abrir popup/aba, o resultado traz popups[].opened.tabId: use esse tab_id nas próximas chamadas. Relatórios baixados aparecem em downloads[].filename.',
            parameters: object({ ref: string, tab_id: number }, ['ref']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'hover',
            description:
                'Passa o mouse sobre um elemento (para menus que abrem com hover). Use o ref retornado por get_page.',
            parameters: object({ ref: string, tab_id: number }, ['ref']),
        },
    },
    {
        type: 'function',
        function: {
            name: 'type',
            description:
                'Digita em um campo da aba usando o ref retornado por get_page (inclusive frame:gN). Use submit=true para enviar o formulário ou pressionar Enter.',
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
                'Rola a página ou o container rolável principal (funciona em docs com div overflow). Em páginas com frames, informe frame (do get_page) ou ele escolhe o mais rolável. Retorna posição, altura e se chegou ao fim. Use to=top/bottom para ir direto.',
            parameters: object(
                {
                    direction: { type: 'string', enum: ['up', 'down'] },
                    to: { type: 'string', enum: ['top', 'bottom'] },
                    amount: number,
                    frame: string,
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

async function executeAll(tabId: number, code: string): Promise<any[]> {
    try {
        const results = await browser.tabs.executeScript(tabId, {
            code,
            runAt: 'document_idle',
            allFrames: true,
        });
        return (results ?? []).filter((result) => result !== undefined);
    } catch (error) {
        console.warn('[Goatai] executeScript allFrames failed', error);
        return [];
    }
}

function framePath() {
    try {
        const parts: string[] = [];
        let current: Window = window;
        while (current && current !== current.parent) {
            let name = current.name || '';
            if (!name) {
                try {
                    name = `#${Array.prototype.indexOf.call(current.parent.frames, current)}`;
                } catch {
                    name = '#';
                }
            }
            parts.unshift(String(name).replace(/[^A-Za-z0-9_.-]/g, '_'));
            current = current.parent;
        }
        return parts.length > 0 ? parts.join('/') : 'top';
    } catch {
        return 'frame';
    }
}

function splitRef(ref: string): { frame: string; local: string } {
    const separator = ref.lastIndexOf(':');
    if (separator > 0) {
        return { frame: ref.slice(0, separator), local: ref.slice(separator + 1) };
    }
    return { frame: 'top', local: ref };
}

function collectFrameResults(
    tabId: number,
    action: string,
    args: Record<string, any> = {},
    timeout = 600,
    requestId = crypto.randomUUID(),
): Promise<any[]> {
    const results: any[] = [];
    const listener = (message: any) => {
        if (message?.type === 'goatai:frame-result' && message.requestId === requestId && message.data) {
            results.push(message.data);
        }
    };
    browser.runtime.onMessage.addListener(listener);
    browser.tabs.sendMessage(tabId, { type: 'goatai:frame', requestId, action, args }).catch(() => {});
    return new Promise((resolve) => {
        setTimeout(() => {
            browser.runtime.onMessage.removeListener(listener);
            resolve(results);
        }, timeout);
    });
}

async function sendFrameAction(
    tabId: number,
    action: string,
    args: Record<string, any>,
    timeout = 500,
    requestId?: string,
): Promise<any> {
    const results = await collectFrameResults(tabId, action, args, timeout, requestId);
    return results.find((result) => result && result.ok !== false) ?? results[0];
}

function isFileUrl(url: URL) {
    const path = url.pathname.toLowerCase();
    return (
        /\.(pdf|zip|csv|xls|xlsx|doc|docx|txt|rtf|odt|ods)$/.test(path) ||
        /adoc_download_proc|download|export|impress|print|report/.test(path)
    );
}

async function openCapturedUrl(url: string) {
    try {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol)) {
            return null;
        }
        const downloads = (browser as any).downloads;
        if (isFileUrl(target) && downloads?.download) {
            const id = await downloads.download({ url: target.href, saveAs: false });
            return { via: 'download', id };
        }
        const tab = await browser.tabs.create({ url: target.href, active: false });
        return { via: 'tab', tabId: tab.id };
    } catch {
        return null;
    }
}

function describeDownload(item: any) {
    return {
        id: item.id,
        filename: item.filename,
        mime: item.mime,
        bytes: item.fileSize ?? item.totalBytes,
        state: item.state,
        url: item.url,
    };
}

function trackDownloads() {
    const items: any[] = [];
    const listener = (item: any) => items.push(item);
    try {
        (browser as any).downloads?.onCreated?.addListener(listener);
    } catch {
        // sem permissão de downloads; segue sem rastrear
    }
    return {
        items,
        stop: () => {
            try {
                (browser as any).downloads?.onCreated?.removeListener(listener);
            } catch {
                // ignore
            }
        },
    };
}

function pageSnapshot(frameKey: string) {
    const frameName = window.name || '';
    const selector =
        'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [contenteditable="true"], [onclick], [onmousedown], [onmouseover], [onmouseenter], img[onclick]';
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
        const ref = `${frameKey}:g${index + 1}`;
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
    const isPdf =
        /(?:drive|docs)\.google\.com\/file\/d\//.test(location.href) || /\.pdf(?:$|[?#])/i.test(location.href);
    return {
        frame: frameKey,
        frameName,
        url: location.href,
        title: document.title,
        pdf: isPdf || undefined,
        hint: isPdf
            ? 'Esta página é um PDF ou viewer de PDF. Use read_pdf (query=termo) para ler o conteúdo.'
            : undefined,
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

function scrollPage(direction: string, to: string, amount: number, frameKey: string) {
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
        if (!style) {
            continue;
        }
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
        frame: frameKey,
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

function findText(query: string, frameKey: string) {
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
        frame: frameKey,
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

    if (name === 'read_pdf') {
        const url = args.url
            ? String(args.url)
            : (await resolveTab(typeof args.tab_id === 'number' ? args.tab_id : undefined)).url;
        if (!url || !/^https?:/i.test(url)) {
            throw new Error('URL de PDF inválida');
        }
        const document = await loadPdf(url);
        const pageNumber = Number(args.page);
        if (Number.isInteger(pageNumber) && pageNumber > 0) {
            if (pageNumber > document.pages) {
                return {
                    ok: false,
                    error: 'page_out_of_range',
                    pages: document.pages,
                    message: `O PDF tem ${document.pages} páginas.`,
                };
            }
            const pageText = document.pagesText[pageNumber - 1] ?? '';
            return {
                ok: true,
                url: document.url,
                sourceUrl: url,
                pages: document.pages,
                page: pageNumber,
                chars: pageText.length,
                text: pageText.slice(0, 15000),
                truncated: pageText.length > 15000,
            };
        }

        const query = String(args.query ?? '').trim();
        if (query) {
            const matches = searchPdf(document, query);
            return {
                ok: true,
                url: document.url,
                sourceUrl: url,
                pages: document.pages,
                query,
                matches,
                latest: matches.at(-1) ?? null,
                note: matches.length
                    ? 'Se houver várias ocorrências, a última costuma ser a mais recente (ex.: 2º semestre).'
                    : 'Nenhuma ocorrência encontrada. Tente query "término das aulas" ou "dezembro".',
            };
        }
        const max = 30000;
        return {
            ok: true,
            url: document.url,
            sourceUrl: url,
            pages: document.pages,
            chars: document.text.length,
            text: document.text.slice(0, max),
            truncated: document.text.length > max,
        };
    }

    const tab = await resolveTab(typeof args.tab_id === 'number' ? args.tab_id : undefined);
    if (!tab.id) {
        throw new Error('Aba sem id');
    }

    switch (name) {
        case 'get_page': {
            const snapshots = await collectFrameResults(tab.id, 'snapshot', {}, 800);
            const visible = snapshots.filter((snapshot) => snapshot && (snapshot.text || snapshot.elements?.length));
            const text = visible
                .map(
                    (snapshot) =>
                        `--- frame: ${snapshot.frame} (${snapshot.frameName || snapshot.url}) ---\n${snapshot.text}`,
                )
                .join('\n\n')
                .slice(0, 18000);
            const elements = visible.flatMap((snapshot) =>
                (snapshot.elements ?? []).map((element: any) => ({ ...element, frame: snapshot.frame })),
            );
            return {
                url: tab.url,
                title: visible.find((snapshot) => snapshot.title)?.title ?? tab.title,
                frames: visible.map(({ text: _text, elements: _elements, ...rest }) => rest),
                text,
                elements,
                scroll: visible.map((snapshot) => ({ frame: snapshot.frame, ...snapshot.scroll })),
                hint: visible.length
                    ? undefined
                    : 'Nenhum conteúdo acessível nos frames. Recarregue a página para ativar o agente ou faça login.',
            };
        }

        case 'find_text': {
            const query = String(args.query ?? '');
            const results = await collectFrameResults(tab.id, 'find', { query }, 800);
            const withMatches = results.filter((result) => result?.matches?.length);
            return {
                found: withMatches.length > 0,
                query,
                count: withMatches.reduce((sum, result) => sum + result.matches.length, 0),
                frames: withMatches.map((result) => ({
                    frame: result.frame,
                    title: result.title,
                    url: result.url,
                    matches: result.matches,
                })),
            };
        }

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
            const { frame, local } = splitRef(String(args.ref));
            if (!/^g\d+$/.test(local)) {
                throw new Error('ref inválido');
            }
            const requestId = crypto.randomUUID();
            const popups: any[] = [];
            const onPopup = (message: any) => {
                if (message?.type === 'goatai:popup' && message.requestId === requestId) {
                    popups.push(message);
                }
            };
            const downloads = trackDownloads();
            browser.runtime.onMessage.addListener(onPopup);
            try {
                const result = await sendFrameAction(
                    tab.id,
                    'click',
                    { ref: `${frame}:${local}`, frame, requestId },
                    900,
                    requestId,
                );
                if (!result || result.ok === false) {
                    throw new Error(result?.error ?? 'element_not_found');
                }
                await waitAfterAction(tab.id);
                await sleep(1800);
                for (const popup of popups) {
                    const opened = await openCapturedUrl(String(popup.url));
                    if (opened) {
                        popup.opened = opened;
                    }
                }
                if (popups.length) {
                    await sleep(1200);
                }
                return {
                    ...result,
                    ...(popups.length ? { popups } : {}),
                    ...(downloads.items.length
                        ? { downloads: downloads.items.map((item) => describeDownload(item)) }
                        : {}),
                };
            } finally {
                browser.runtime.onMessage.removeListener(onPopup);
                downloads.stop();
            }
        }

        case 'hover': {
            const { frame, local } = splitRef(String(args.ref));
            if (!/^g\d+$/.test(local)) {
                throw new Error('ref inválido');
            }
            const result = await sendFrameAction(tab.id, 'hover', { ref: `${frame}:${local}`, frame });
            if (!result || result.ok === false) {
                throw new Error(result?.error ?? 'element_not_found');
            }
            await sleep(300);
            return result;
        }

        case 'type': {
            const { frame, local } = splitRef(String(args.ref));
            if (!/^g\d+$/.test(local)) {
                throw new Error('ref inválido');
            }
            const result = await sendFrameAction(tab.id, 'type', {
                ref: `${frame}:${local}`,
                frame,
                text: String(args.text ?? ''),
                submit: Boolean(args.submit),
            });
            if (!result || result.ok === false) {
                throw new Error(result?.error ?? 'element_not_found');
            }
            if (args.submit) {
                await waitAfterAction(tab.id!);
            }
            return result;
        }

        case 'scroll': {
            let frame = String(args.frame ?? '');
            if (!frame) {
                const snapshots = await collectFrameResults(tab.id, 'snapshot', {}, 800);
                const best = snapshots
                    .filter((snapshot) => snapshot?.scroll)
                    .sort((a, b) => b.scroll.height - b.scroll.viewport - (a.scroll.height - a.scroll.viewport))[0];
                frame = best?.frame ?? 'top';
            }
            const amount = Math.min(Math.max(Number(args.amount) || 600, 50), 5000);
            const direction = String(args.direction ?? 'down');
            const to = ['top', 'bottom'].includes(String(args.to)) ? String(args.to) : '';
            const result = await sendFrameAction(tab.id, 'scroll', {
                frame,
                direction,
                to,
                amount,
            });
            await sleep(300);
            return result ?? { ok: false, error: 'frame_unavailable', frame };
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
