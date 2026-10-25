import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { parseMarkdown, type InlineToken } from '@/core/ui/markdown';
import { cn } from '@/lib/utils';

// KaTeX output is the only HTML injected, and KaTeX escapes its input, so a
// note body can never smuggle markup into the page.
function MathSpan({ tex, display = false }: { tex: string; display?: boolean }) {
    const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, strict: 'ignore', displayMode: display }), [tex, display]);
    // Display math scrolls sideways rather than overflowing a narrow panel.
    return display
        ? <span className="my-1 block overflow-x-auto overflow-y-hidden" dangerouslySetInnerHTML={{ __html: html }} />
        : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Inline({ tokens }: { tokens: InlineToken[] }) {
    return <>{tokens.map((token, index) => {
        switch (token.type) {
            case 'text': return <span key={index}>{token.text}</span>;
            case 'strong': return <strong key={index} className="font-semibold text-text"><Inline tokens={token.children} /></strong>;
            case 'em': return <em key={index}><Inline tokens={token.children} /></em>;
            case 'code': return <code key={index} className="rounded-sm bg-sunken px-1 font-mono text-[0.92em]">{token.text}</code>;
            case 'math': return <MathSpan key={index} tex={token.tex} display={token.display} />;
            case 'link': return (
                <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                    <Inline tokens={token.children} />
                </a>
            );
        }
    })}</>;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
    const blocks = useMemo(() => parseMarkdown(source), [source]);
    return (
        <div className={cn('space-y-2 text-sm leading-relaxed text-text-soft', className)}>
            {blocks.map((block, index) => {
                if (block.type === 'heading') {
                    const size = block.level === 1 ? 'text-md' : block.level === 2 ? 'text-base' : 'text-sm';
                    return <p key={index} role="heading" aria-level={block.level + 2} className={cn('font-semibold text-text', size)}><Inline tokens={block.children} /></p>;
                }
                if (block.type === 'list') {
                    const ListTag = block.ordered ? 'ol' : 'ul';
                    return (
                        <ListTag key={index} className={cn('space-y-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
                            {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline tokens={item} /></li>)}
                        </ListTag>
                    );
                }
                return <p key={index}><Inline tokens={block.children} /></p>;
            })}
        </div>
    );
}
