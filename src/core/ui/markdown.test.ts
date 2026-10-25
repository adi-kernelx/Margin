import { describe, expect, it } from 'vitest';
import { isSafeHref, parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
    it('recognises bold, italic, code and math', () => {
        expect(parseInline('a **b** *c* `d` $e^2$')).toEqual([
            { type: 'text', text: 'a ' },
            { type: 'strong', children: [{ type: 'text', text: 'b' }] },
            { type: 'text', text: ' ' },
            { type: 'em', children: [{ type: 'text', text: 'c' }] },
            { type: 'text', text: ' ' },
            { type: 'code', text: 'd' },
            { type: 'text', text: ' ' },
            { type: 'math', tex: 'e^2' },
        ]);
    });

    it('keeps emphasis markers literal inside code', () => {
        expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }]);
    });

    it('keeps safe links and drops unsafe targets to text', () => {
        expect(parseInline('[site](https://example.org)')).toEqual([
            { type: 'link', href: 'https://example.org', children: [{ type: 'text', text: 'site' }] },
        ]);
        expect(parseInline('[x](javascript:void)')).toEqual([{ type: 'text', text: 'x' }]);
        expect(parseInline('[x](javascript:alert(1))').some(token => token.type === 'link')).toBe(false);
    });

    it('never emits raw HTML as anything but text', () => {
        expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([
            { type: 'text', text: '<img src=x onerror=alert(1)>' },
        ]);
    });
});

describe('parseMarkdown', () => {
    it('splits headings, paragraphs and lists', () => {
        const blocks = parseMarkdown('# Title\nfirst line\nsecond line\n\n- one\n- two\n1. a\n2. b');
        expect(blocks.map(block => block.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
        expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'first line second line' }] });
        expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] });
        expect(blocks[3]).toMatchObject({ ordered: true });
    });

    it('returns no blocks for blank input', () => {
        expect(parseMarkdown('  \n\n')).toEqual([]);
    });
});

describe('LaTeX delimiters written by language models', () => {
    it('reads \\( \\) as inline math and keeps citations as text', () => {
        expect(parseInline('[1] The gradient \\(\\nabla f = \\left(\\frac{\\partial f}{\\partial x_1}\\right)\\) points up.')).toEqual([
            { type: 'text', text: '[1] The gradient ' },
            { type: 'math', tex: '\\nabla f = \\left(\\frac{\\partial f}{\\partial x_1}\\right)' },
            { type: 'text', text: ' points up.' },
        ]);
    });

    it('reads \\[ \\] and $$ $$ as display math, also across lines', () => {
        expect(parseInline('\\[ x_{k+1} = x_k - \\alpha \\nabla f \\]')).toEqual([
            { type: 'math', tex: 'x_{k+1} = x_k - \\alpha \\nabla f', display: true },
        ]);
        expect(parseMarkdown('Update:\n$$\na + b\n$$\ndone')[0]).toEqual({
            type: 'paragraph',
            children: [
                { type: 'text', text: 'Update: ' },
                { type: 'math', tex: 'a + b', display: true },
                { type: 'text', text: ' done' },
            ],
        });
    });

    it('still reads single-dollar math', () => {
        expect(parseInline('$x^2$')).toEqual([{ type: 'math', tex: 'x^2' }]);
    });
});

describe('isSafeHref', () => {
    it('allows only http(s) and mailto', () => {
        expect(isSafeHref('http://a')).toBe(true);
        expect(isSafeHref('mailto:a@b.c')).toBe(true);
        expect(isSafeHref('data:text/html,x')).toBe(false);
    });
});
