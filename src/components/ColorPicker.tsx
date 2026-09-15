import { useDocumentStore } from '@/hooks/useDocumentStore';
import { Popover } from './ui/Popover';
import { StrokeWidthControl } from './ui/StrokeWidthControl';

interface ColorPickerProps {
    isOpen: boolean;
    onClose: () => void;
    toolMode: 'pencil' | 'rectangle' | 'arrow';
}

const colors = [
    ['Black', '#000000'], ['Red', '#D32F2F'], ['Blue', '#1565C0'], ['Green', '#2E7D32'],
    ['Orange', '#EF6C00'], ['Purple', '#7B1FA2'], ['Pink', '#C2185B'], ['Teal', '#00796B'],
    ['Brown', '#6D4C41'], ['Grey', '#616161'], ['Cyan', '#00838F'], ['Lime', '#827717'],
] as const;

export function ColorPicker({ isOpen, onClose, toolMode }: ColorPickerProps) {
    const state = useDocumentStore();
    const settings = toolMode === 'pencil'
        ? { color: state.pencilColor, setColor: state.setPencilColor, width: state.pencilWidth, setWidth: state.setPencilWidth }
        : toolMode === 'rectangle'
            ? { color: state.rectangleColor, setColor: state.setRectangleColor, width: state.rectangleWidth, setWidth: state.setRectangleWidth }
            : { color: state.arrowColor, setColor: state.setArrowColor, width: state.arrowWidth, setWidth: state.setArrowWidth };
    const title = `${toolMode[0].toUpperCase()}${toolMode.slice(1)} style`;

    return (
        <Popover open={isOpen && state.annotationMode === toolMode} title={title} onClose={onClose} className="left-16 top-20 w-72">
            <div className="space-y-4">
                <fieldset>
                    <legend className="mb-2 text-xs font-semibold text-text-soft">Colour</legend>
                    <div className="grid grid-cols-6 gap-2">
                        {colors.map(([name, color]) => (
                            <button
                                key={color}
                                type="button"
                                aria-label={`Use ${name}`}
                                aria-pressed={settings.color === color}
                                className="size-8 rounded border-2 border-line transition-transform duration-state hover:scale-105 aria-pressed:border-accent aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-accent"
                                style={{ backgroundColor: color }}
                                onClick={() => settings.setColor(color)}
                            />
                        ))}
                    </div>
                </fieldset>
                <label className="flex items-center gap-3 text-xs font-semibold text-text-soft">
                    Custom
                    <input type="color" value={settings.color} onChange={(event) => settings.setColor(event.target.value)} className="h-8 flex-1 cursor-pointer rounded border border-line bg-surface-2" />
                    <output className="font-mono text-text-muted">{settings.color.toUpperCase()}</output>
                </label>
                <StrokeWidthControl value={settings.width} onChange={settings.setWidth} max={12} />
            </div>
        </Popover>
    );
}
