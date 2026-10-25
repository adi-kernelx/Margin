// A deliberately small Markdown parser for note bodies.
//
// It produces a token tree the shell renders as React elements, so no
// user-written HTML ever reaches the DOM. Supported: ATX headings (#–###),
// bullet and numbered lists, paragraphs, **bold**, *italic*, `code`,
// [links](https://…), inline math as $…$ or \(…\), and display math as
// $$…$$ or \[…\] (the forms language models write). Link targets other than http(s) and
// mailto are dropped to plain text, which is the whole sanitisation story.

export type InlineToken =
    | { type: 'text'; text: string }
    | { type: 'strong'; children: InlineToken[] }
    | { type: 'em'; children: InlineToken[] }
    | { type: 'code'; text: string }
    | { type: 'math'; tex: string; display?: boolean }
    | { type: 'link'; href: string; children: InlineToken[] };

export type BlockToken =
    | { type: 'heading'; level: 1 | 2 | 3; children: InlineToken[] }
    | { type: 'paragraph'; children: InlineToken[] }
    | { type: 'list'; ordered: boolean; items: InlineToken[][] };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function isSafeHref(href: string): boolean {
    return SAFE_HREF.test(href.trim());
}

// Order matters: code and math are opaque, so they are tried before emphasis,
// and $$…$$ before $…$. Groups: 1 code, 2 $$…$$, 3 \[…\], 4 \(…\), 5 $…$,
// 6 bold, 7 italic, 8 link.
const INLINE_PATTERN = /(`[^`]+`)|(\$\$[\s\S]+?\$\$)|(\\\[[\s\S]+?\\\])|(\\\([\s\S]+?\\\))|(\$[^$\n]+\$)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/;

export function parseInline(source: string): InlineToken[] {
    const tokens: InlineToken[] = [];
    let rest = source;
    while (rest) {
        const match = INLINE_PATTERN.exec(rest);
        if (!match) {
            tokens.push({ type: 'text', text: rest });
            break;
        }
        if (match.index > 0) tokens.push({ type: 'text', text: rest.slice(0, match.index) });
        const raw = match[0];
        if (match[1]) tokens.push({ type: 'code', text: raw.slice(1, -1) });
        else if (match[2] || match[3]) tokens.push({ type: 'math', tex: raw.slice(2, -2).trim(), display: true });
        else if (match[4]) tokens.push({ type: 'math', tex: raw.slice(2, -2).trim() });
        else if (match[5]) tokens.push({ type: 'math', tex: raw.slice(1, -1) });
        else if (match[6]) tokens.push({ type: 'strong', children: parseInline(raw.slice(2, -2)) });
        else if (match[7]) tokens.push({ type: 'em', children: parseInline(raw.slice(1, -1)) });
        else {
            const split = raw.indexOf('](');
            const label = raw.slice(1, split);
            const href = raw.slice(split + 2, -1);
            if (isSafeHref(href)) tokens.push({ type: 'link', href, children: parseInline(label) });
            else tokens.push({ type: 'text', text: label });
        }
        rest = rest.slice(match.index + raw.length);
    }
    return mergeText(tokens);
}

function mergeText(tokens: InlineToken[]): InlineToken[] {
    const merged: InlineToken[] = [];
    for (const token of tokens) {
        const last = merged[merged.length - 1];
        if (token.type === 'text' && last?.type === 'text') last.text += token.text;
        else merged.push(token);
    }
    return merged;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

interface PendingList {
    ordered: boolean;
    items: InlineToken[][];
}

export function parseMarkdown(source: string): BlockToken[] {
    const blocks: BlockToken[] = [];
    let paragraph: string[] = [];
    // Held in an object so the flush closures and the loop share one
    // mutable slot without defeating TypeScript's narrowing.
    const pending: { list: PendingList | null } = { list: null };

    const flushParagraph = () => {
        if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
        paragraph = [];
    };
    const flushList = () => {
        if (pending.list) blocks.push({ type: 'list', ...pending.list });
        pending.list = null;
    };

    for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
        const heading = HEADING.exec(line);
        const bullet = BULLET.exec(line);
        const numbered = bullet ? null : NUMBERED.exec(line);

        if (!line.trim()) {
            flushParagraph();
            flushList();
        } else if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
        } else if (bullet || numbered) {
            flushParagraph();
            const ordered = Boolean(numbered);
            const item = parseInline((bullet ?? numbered)![1]);
            if (pending.list?.ordered === ordered) {
                pending.list.items.push(item);
            } else {
                flushList();
                pending.list = { ordered, items: [item] };
            }
        } else {
            flushList();
            paragraph.push(line.trim());
        }
    }
    flushParagraph();
    flushList();
    return blocks;
}
