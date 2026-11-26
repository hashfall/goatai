import { browser } from 'wxt/browser';

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

function snapshot() {
    const frameKey = framePath();
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
        frameName: window.name || '',
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
    return { found: matches.length > 0, frame: framePath(), query, matches, url: location.href, title: document.title };
}

function clickElement(ref: string) {
    const element = document.querySelector(`[data-goatai-ref="${ref}"]`) as HTMLElement | null;
    if (!element) {
        return { ok: false, error: 'element_not_found' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    for (const type of ['mouseover', 'mousedown', 'mouseup']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
    element.click();
    return { ok: true, tag: element.tagName.toLowerCase() };
}

function hoverElement(ref: string) {
    const element = document.querySelector(`[data-goatai-ref="${ref}"]`);
    if (!element) {
        return { ok: false, error: 'element_not_found' };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    for (const type of ['mouseover', 'mouseenter', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return { ok: true, tag: element.tagName.toLowerCase() };
}

function typeElement(ref: string, value: string, submit: boolean) {
    const element = document.querySelector(`[data-goatai-ref="${ref}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
    if (!element) {
        return { ok: false, error: 'element_not_found' };
    }
    element.focus();
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
        setter.call(element, value);
    } else {
        element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) {
        const form = (element.form || element.closest('form')) as HTMLFormElement | null;
        if (form?.requestSubmit) {
            form.requestSubmit();
        } else if (form) {
            form.submit();
        } else {
            element.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                }),
            );
        }
    }
    return { ok: true };
}

function scrollDocument(direction: string, to: string, amount: number) {
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
        return { ok: false, error: 'no_scrollable_container', frame: framePath() };
    }
    if (to === 'bottom') {
        best.scrollTop = best.scrollHeight;
    } else if (to === 'top') {
        best.scrollTop = 0;
    } else {
        best.scrollBy({ top: direction === 'up' ? -amount : amount, behavior: 'auto' });
    }
    return {
        ok: true,
        frame: framePath(),
        after: Math.round(best.scrollTop),
        height: best.scrollHeight,
        viewport: best.clientHeight,
        atTop: best.scrollTop <= 1,
        atBottom: best.scrollTop + best.clientHeight >= best.scrollHeight - 2,
    };
}

function handle(action: string, args: Record<string, any>) {
    switch (action) {
        case 'snapshot':
            return snapshot();
        case 'find':
            return findText(String(args.query ?? ''));
        case 'click':
            return clickElement(String(args.ref ?? ''));
        case 'hover':
            return hoverElement(String(args.ref ?? ''));
        case 'type':
            return typeElement(String(args.ref ?? ''), String(args.text ?? ''), Boolean(args.submit));
        case 'scroll':
            return scrollDocument(String(args.direction ?? 'down'), String(args.to ?? ''), Number(args.amount) || 600);
        default:
            return { ok: false, error: 'unknown_action' };
    }
}

export default defineContentScript({
    matches: ['<all_urls>'],
    allFrames: true,
    runAt: 'document_idle',
    main() {
        browser.runtime.onMessage.addListener((message: any) => {
            if (message?.type !== 'goatai:frame') {
                return;
            }
            const key = framePath();
            if (message.args?.frame && message.args.frame !== key) {
                return;
            }
            let data: any;
            try {
                data = { ...handle(message.action, message.args ?? {}), frame: key };
            } catch (error) {
                data = { ok: false, frame: key, error: error instanceof Error ? error.message : String(error) };
            }
            browser.runtime
                .sendMessage({
                    type: 'goatai:frame-result',
                    requestId: message.requestId,
                    data,
                })
                .catch(() => {});
        });
    },
});
