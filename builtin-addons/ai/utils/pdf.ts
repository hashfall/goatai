import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDocumentData {
    url: string;
    pages: number;
    text: string;
    pagesText: string[];
}

const cache = new Map<string, Promise<PdfDocumentData>>();

export function pdfCandidates(url: string): string[] {
    const candidates: string[] = [];
    const drive = url.match(/(?:drive|docs)\.google\.com\/file\/d\/([^/?#]+)/);
    if (drive) {
        const id = drive[1];
        candidates.push(`https://drive.google.com/uc?export=download&id=${id}`);
        candidates.push(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    } else if (/^https?:\/\//.test(url)) {
        candidates.push(url);
    }
    return candidates;
}

async function fetchPdfBytes(url: string): Promise<{ bytes: Uint8Array; source: string } | null> {
    for (const candidate of pdfCandidates(url)) {
        try {
            const response = await fetch(candidate, {
                credentials: 'include',
                redirect: 'follow',
            });
            if (!response.ok) {
                continue;
            }
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const head = new TextDecoder().decode(bytes.slice(0, 5));
            if (head === '%PDF-') {
                return { bytes, source: candidate };
            }
        } catch (error) {
            console.warn('[Goatai] failed to fetch PDF', candidate, error);
        }
    }
    return null;
}

function extractPageText(items: any[]): string {
    const parts = items
        .filter((item) => typeof item.str === 'string' && item.str.trim())
        .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

    const lines: string[] = [];
    let line = '';
    let lastY: number | null = null;
    for (const item of parts) {
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) {
            if (line.trim()) {
                lines.push(line.trim());
            }
            line = '';
        }
        line += (line ? ' ' : '') + item.str;
        lastY = y;
    }
    if (line.trim()) {
        lines.push(line.trim());
    }
    return lines.join('\n');
}

async function extractPdf(url: string): Promise<PdfDocumentData> {
    const fetched = await fetchPdfBytes(url);
    if (!fetched) {
        throw new Error(
            'Não consegui baixar o PDF. Verifique se o link é público ou se você está autenticado no Drive.',
        );
    }

    const document = await pdfjsLib.getDocument({
        data: fetched.bytes,
        useWorkerFetch: false,
    }).promise;

    const pagesText: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pagesText.push(extractPageText(content.items as any[]));
    }

    const text = pagesText.map((page, index) => `--- Página ${index + 1} ---\n${page}`).join('\n\n');
    return {
        url: fetched.source,
        pages: document.numPages,
        text,
        pagesText,
    };
}

export function loadPdf(url: string): Promise<PdfDocumentData> {
    let pending = cache.get(url);
    if (!pending) {
        pending = extractPdf(url);
        cache.set(url, pending);
    }
    return pending;
}

function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

export function searchPdf(document: PdfDocumentData, query: string, limit = 8) {
    const needle = normalize(query).trim();
    if (!needle) {
        return [];
    }
    const variants = new Set([needle]);
    if (/\b(fim|acabam|terminam|encerramento|encerram)\b/.test(needle)) {
        variants.add('termino');
    }
    if (needle.includes('aula') && !needle.includes('termino')) {
        variants.add('termino das aulas');
    }

    const seen = new Set<string>();
    const matches: { page: number; snippet: string; matched: string }[] = [];
    for (const variant of variants) {
        for (let index = 0; index < document.pagesText.length; index++) {
            const page = document.pagesText[index] ?? '';
            const haystack = normalize(page);
            let from = 0;
            let position: number;
            while ((position = haystack.indexOf(variant, from)) !== -1) {
                const start = Math.max(0, position - 120);
                const end = Math.min(page.length, position + variant.length + 180);
                const snippet = page.slice(start, end).replace(/\s+/g, ' ').trim();
                const key = `${index}:${start}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    matches.push({ page: index + 1, snippet, matched: variant });
                }
                from = position + variant.length;
                if (matches.length >= limit) {
                    return matches.sort((a, b) => a.page - b.page);
                }
            }
        }
    }
    return matches.sort((a, b) => a.page - b.page);
}
