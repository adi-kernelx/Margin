import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { SplitDirection } from '@/core/workspace/layout';

interface ResizablePanelGroupProps {
    direction: SplitDirection;
    firstShare: number;
    onResize: (firstShare: number) => void;
    children: [ReactNode, ReactNode];
    label: string;
}

export function ResizablePanelGroup({ direction, firstShare, onResize, children, label }: ResizablePanelGroupProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const isHorizontal = direction === 'horizontal';

    const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const update = (pointerEvent: PointerEvent) => onResize(isHorizontal
            ? (pointerEvent.clientX - bounds.left) / bounds.width
            : (pointerEvent.clientY - bounds.top) / bounds.height);
        const finish = () => {
            window.removeEventListener('pointermove', update);
            window.removeEventListener('pointerup', finish);
        };
        window.addEventListener('pointermove', update);
        window.addEventListener('pointerup', finish, { once: true });
    };

    const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
        const decrease = isHorizontal ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
        const increase = isHorizontal ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
        if (!decrease && !increase) return;
        event.preventDefault();
        onResize(firstShare + (increase ? 0.05 : -0.05));
    };

    return (
        <div ref={containerRef} className={`workspace-split workspace-split--${direction}`}>
            <div className="workspace-split__child" style={{ flexBasis: `${firstShare * 100}%` }}>{children[0]}</div>
            <div
                className={`workspace-divider workspace-divider--${direction}`}
                role="separator"
                aria-label={label}
                aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
                aria-valuemin={15}
                aria-valuemax={85}
                aria-valuenow={Math.round(firstShare * 100)}
                tabIndex={0}
                onPointerDown={beginResize}
                onKeyDown={resizeWithKeyboard}
            />
            <div className="workspace-split__child" style={{ flexBasis: `${(1 - firstShare) * 100}%` }}>{children[1]}</div>
        </div>
    );
}
