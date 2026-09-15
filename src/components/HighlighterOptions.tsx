import { useDocumentStore } from '@/hooks/useDocumentStore';
import type { HighlighterMode } from '@/lib/store';
import { Popover } from './ui/Popover';
import { SegmentedControl } from './ui/SegmentedControl';
import { StrokeWidthControl } from './ui/StrokeWidthControl';

interface HighlighterOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

const modes = [
    { value: 'freeform', label: 'Freeform', description: 'Draw anywhere on the page.' },
    { value: 'text-aware', label: 'Text', description: 'Snap highlights to selected text.' },
] satisfies ReadonlyArray<{ value: HighlighterMode; label: string; description: string }>;

const colors = [
    ['Yellow', '#FFEB3B'], ['Green', '#4CAF50'], ['Blue', '#2196F3'],
    ['Pink', '#E91E63'], ['Orange', '#FF9800'], ['Purple', '#9C27B0'],
] as const;

export function HighlighterOptions({ isOpen, onClose }: HighlighterOptionsProps) {
    const {
        annotationMode, highlighterMode, setHighlighterMode, highlighterColor,
        setHighlighterColor, highlighterOpacity, setHighlighterOpacity,
        highlighterWidth, setHighlighterWidth,
    } = useDocumentStore();

    return (
        <Popover open={isOpen && annotationMode === 'highlighter'} title="Highlighter options" onClose={onClose} className="left-16 top-24 w-72">
            <div className="space-y-4">
                <SegmentedControl label="Mode" value={highlighterMode} options={modes} onChange={setHighlighterMode} />
                {highlighterMode === 'freeform' && (
                    <StrokeWidthControl value={highlighterWidth} onChange={setHighlighterWidth} min={6} max={30} />
                )}
                <fieldset>
                    <legend className="mb-2 text-xs font-semibold text-text-soft">Colour</legend>
                    <div className="grid grid-cols-6 gap-2">
                        {colors.map(([name, color]) => (
                            <button
                                key={color}
                                type="button"
                                aria-label={`${name} highlighter`}
                                aria-pressed={highlighterColor === color}
                                className="size-8 rounded border-2 border-line transition-transform duration-state hover:scale-105 aria-pressed:border-accent aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-accent"
                                style={{ backgroundColor: color }}
                                onClick={() => setHighlighterColor(color)}
                            />
                        ))}
                    </div>
                </fieldset>
                <label className="block space-y-2 text-xs font-semibold text-text-soft">
                    <span className="flex justify-between"><span>Opacity</span><output className="font-mono text-text-muted">{Math.round(highlighterOpacity * 100)}%</output></span>
                    <input type="range" min="0.1" max="0.5" step="0.05" value={highlighterOpacity} onChange={(event) => setHighlighterOpacity(Number(event.target.value))} className="w-full accent-accent" />
                </label>
            </div>
        </Popover>
    );
}
