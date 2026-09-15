import { Bold, Italic, Underline } from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Popover } from './ui/Popover';
import { StrokeWidthControl } from './ui/StrokeWidthControl';

interface TextOptionsProps {
    isOpen: boolean;
    onClose: () => void;
}

const fontFamilies = [
    ['System', 'system-ui, -apple-system, sans-serif'], ['Arial', 'Arial, sans-serif'],
    ['Times New Roman', 'Times New Roman, serif'], ['Courier New', 'Courier New, monospace'],
    ['Georgia', 'Georgia, serif'], ['Verdana', 'Verdana, sans-serif'],
] as const;

export function TextOptions({ isOpen, onClose }: TextOptionsProps) {
    const state = useDocumentStore();
    return (
        <Popover open={isOpen && state.annotationMode === 'text'} title="Text options" onClose={onClose} className="left-16 top-24 w-72">
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
                <label className="flex items-center justify-between gap-3 text-xs font-semibold text-text-soft">
                    Text colour
                    <input type="color" value={state.textColor} onChange={(event) => state.setTextColor(event.target.value)} className="h-8 w-28 cursor-pointer rounded border border-line bg-surface-2" />
                </label>
                <div className="space-y-2">
                    <span className="text-xs font-semibold text-text-soft">Background</span>
                    <div className="flex items-center gap-2">
                        <Button size="sm" variant={state.textBackgroundColor === 'transparent' ? 'primary' : 'secondary'} onClick={() => state.setTextBackgroundColor('transparent')}>Transparent</Button>
                        <input type="color" aria-label="Text background colour" value={state.textBackgroundColor === 'transparent' ? '#ffffff' : state.textBackgroundColor} onChange={(event) => state.setTextBackgroundColor(event.target.value)} className="h-8 flex-1 cursor-pointer rounded border border-line bg-surface-2" />
                    </div>
                </div>
                <label className="block space-y-2 text-xs font-semibold text-text-soft">
                    Font family
                    <select value={state.textFontFamily} onChange={(event) => state.setTextFontFamily(event.target.value)} className="h-9 w-full rounded border border-line bg-surface-2 px-2 text-sm text-text">
                        {fontFamilies.map(([name, value]) => <option key={value} value={value}>{name}</option>)}
                    </select>
                </label>
                <StrokeWidthControl label="Font size" value={state.textFontSize} onChange={state.setTextFontSize} min={8} max={72} />
                <div>
                    <span className="mb-2 block text-xs font-semibold text-text-soft">Style</span>
                    <div className="flex gap-2">
                        <IconButton pressed={state.textBold} onClick={() => state.setTextBold(!state.textBold)} aria-label="Bold"><Bold size={16} /></IconButton>
                        <IconButton pressed={state.textItalic} onClick={() => state.setTextItalic(!state.textItalic)} aria-label="Italic"><Italic size={16} /></IconButton>
                        <IconButton pressed={state.textUnderline} onClick={() => state.setTextUnderline(!state.textUnderline)} aria-label="Underline"><Underline size={16} /></IconButton>
                    </div>
                </div>
            </div>
        </Popover>
    );
}
