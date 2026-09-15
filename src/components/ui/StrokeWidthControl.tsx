interface StrokeWidthControlProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    label?: string;
}

export function StrokeWidthControl({ value, onChange, min = 1, max = 24, label = 'Stroke width' }: StrokeWidthControlProps) {
    return (
        <label className="block space-y-2 text-xs font-semibold text-text-soft">
            <span className="flex items-center justify-between">
                <span>{label}</span>
                <output className="font-mono text-text-muted">{value}px</output>
            </span>
            <input
                type="range"
                min={min}
                max={max}
                step={1}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="w-full accent-accent"
                aria-label={label}
            />
        </label>
    );
}
