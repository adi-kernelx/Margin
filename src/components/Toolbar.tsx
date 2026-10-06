import { useState, useRef } from 'react';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import {
    Highlighter,
    Pencil,
    Type,
    MousePointer2,
    Eraser,
    Square,
    ArrowRight,
    Image as ImageIcon,
    Undo2,
    Redo2,
    Calculator,
    ZoomIn,
    ZoomOut,
    Columns2,
} from 'lucide-react';
import { useDocumentStore } from '@/hooks/useDocumentStore';
import { cn } from '@/lib/utils';
import { HighlighterOptions } from './HighlighterOptions';
import { EraserOptions } from './EraserOptions';
import { TextOptions } from './TextOptions';
import { ImageOptions } from './ImageOptions';
import { SelectOptions } from './SelectOptions';
import { ColorPicker } from './ColorPicker';
import { SaveButton } from './SaveButton';
import { ToolbarGroup } from './ui/ToolbarGroup';
import { Tooltip } from './ui/Tooltip';
import type { AppState, ToolMode } from '@/lib/store';

interface ToolbarProps {
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onSave?: () => void;
    onOpenSaveOptions?: () => void;
    onImageSelect?: (file: File) => void;
    className?: string; // Allow custom positioning
    small?: boolean;
    replicateToolbar?: boolean;
    onToggleReplicate?: () => void;
    isModified?: boolean; // Prop to override store isDirty
    readOnly?: boolean;
}

type ToolKey = NonNullable<ToolMode>;

interface ToolDefinition {
    mode: ToolKey;
    icon: ComponentType<{ size?: number; strokeWidth?: number }>;
    label: string;
    shortcut?: string;
    /** Shown under the name in the tooltip and marked on the button's corner. */
    optionsHint?: string;
    /** Current ink colour, drawn as a strip under the icon. */
    color?: (state: AppState) => string;
}

// On short screens the dock tightens its spacing along with its keys.
const SHORT_GAP = '[@media(max-height:860px)]:gap-0.5';

const TOOLS: ToolDefinition[] = [
    { mode: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V', optionsHint: 'Double-click for selection mode' },
    { mode: 'pencil', icon: Pencil, label: 'Pencil', shortcut: 'P', optionsHint: 'Double-click for colour and width', color: state => state.pencilColor },
    { mode: 'highlighter', icon: Highlighter, label: 'Highlighter', shortcut: 'H', optionsHint: 'Double-click for colour and mode', color: state => state.highlighterColor },
    { mode: 'text', icon: Type, label: 'Text', shortcut: 'T', optionsHint: 'Double-click for font options', color: state => state.textColor },
    { mode: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E', optionsHint: 'Double-click for eraser mode' },
    { mode: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R', optionsHint: 'Double-click for colour and width', color: state => state.rectangleColor },
    { mode: 'arrow', icon: ArrowRight, label: 'Arrow', shortcut: 'A', optionsHint: 'Double-click for colour and width', color: state => state.arrowColor },
    { mode: 'image', icon: ImageIcon, label: 'Image', optionsHint: 'Click to paste · double-click to upload' },
    { mode: 'math', icon: Calculator, label: 'Equation', optionsHint: 'Click again to open the LaTeX editor' },
];

interface DockButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    'aria-label': string;
    active?: boolean;
    compact?: boolean;
    children: ReactNode;
}

/**
 * One key on the dock. Quiet at rest so nine tools do not read as nine
 * buttons; the active tool is the single filled key, which is the one thing
 * the eye should find.
 */
function DockButton({ active = false, compact = false, className, children, type = 'button', ...props }: DockButtonProps) {
    return (
        <button
            type={type}
            aria-pressed={active}
            className={cn(
                'relative grid shrink-0 place-items-center rounded-lg transition-[background-color,color,box-shadow,transform] duration-state',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                'disabled:cursor-not-allowed disabled:opacity-35',
                // Shorter screens get 32px keys so the whole dock fits without scrolling.
                compact ? 'size-8' : 'size-9 [@media(max-height:860px)]:size-8',
                active
                    ? 'bg-accent text-text-onaccent shadow-[var(--elev-1),var(--edge-highlight)]'
                    : 'text-text-soft hover:bg-sunken hover:text-text active:translate-y-px enabled:active:bg-sunken',
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
}

export function Toolbar({
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    onSave,
    onOpenSaveOptions,
    onImageSelect,
    className,
    small,
    replicateToolbar,
    onToggleReplicate,
    isModified,
    readOnly
}: ToolbarProps) {
    const store = useDocumentStore();
    const { annotationMode, setAnnotationMode, isDirty, setMathModalOpen, setScale, scale } = store;
    const [highlighterOptionsOpen, setHighlighterOptionsOpen] = useState(false);
    const effectiveIsModified = isModified !== undefined ? isModified : isDirty;

    const [eraserOptionsOpen, setEraserOptionsOpen] = useState(false);
    const [textOptionsOpen, setTextOptionsOpen] = useState(false);
    const [imageOptionsOpen, setImageOptionsOpen] = useState(false);
    const [selectOptionsOpen, setSelectOptionsOpen] = useState(false);
    const [colorPickerOpen, setColorPickerOpen] = useState<'pencil' | 'rectangle' | 'arrow' | null>(null);
    const clickTimeoutRef = useRef<Partial<Record<ToolKey, ReturnType<typeof setTimeout>>>>({});

    const closePopovers = () => {
        setHighlighterOptionsOpen(false);
        setEraserOptionsOpen(false);
        setTextOptionsOpen(false);
        setImageOptionsOpen(false);
        setSelectOptionsOpen(false);
        setColorPickerOpen(null);
    };

    const handleToolClick = (mode: ToolKey) => {
        if (clickTimeoutRef.current[mode]) {
            clearTimeout(clickTimeoutRef.current[mode]!);
            delete clickTimeoutRef.current[mode];
        }

        // Defer the single-click action until the double-click window has
        // passed, so a double-click opens options without toggling the tool.
        clickTimeoutRef.current[mode] = setTimeout(() => {
            if (annotationMode === mode) {
                // Clicking the active Equation tool opens its editor; any
                // other active tool toggles off.
                if (mode === 'math') setMathModalOpen(true);
                else setAnnotationMode(null);
            } else {
                setAnnotationMode(mode);
            }
            closePopovers();
            delete clickTimeoutRef.current[mode];
        }, 300);
    };

    const handleDoubleClick = (mode: ToolKey) => {
        if (clickTimeoutRef.current[mode]) {
            clearTimeout(clickTimeoutRef.current[mode]!);
            delete clickTimeoutRef.current[mode];
        }
        closePopovers();
        setAnnotationMode(mode);
        if (mode === 'select') setSelectOptionsOpen(true);
        else if (mode === 'highlighter') setHighlighterOptionsOpen(true);
        else if (mode === 'eraser') setEraserOptionsOpen(true);
        else if (mode === 'text') setTextOptionsOpen(true);
        else if (mode === 'image') setImageOptionsOpen(true);
        else if (mode === 'pencil' || mode === 'rectangle' || mode === 'arrow') setColorPickerOpen(mode);
        else if (mode === 'math') setMathModalOpen(true);
    };

    const iconSize = small ? 16 : 18;
    const zoomPercent = Math.round(scale * 100);

    return (
        <div className={cn(
            "z-10 flex flex-col",
            !className && "absolute left-6 top-6", // Default if no class provided
            className
        )}>
            <div
                role="toolbar"
                aria-label="Annotation toolbar"
                aria-orientation="vertical"
                className={cn(
                    // The tool dock is the app's one glass surface: a shallow
                    // backdrop-blur pill floating above the page. The blur is
                    // rationed per §06 of the plan — dialog scrims use a plain
                    // dim instead.
                    "depth-glass flex flex-col gap-1.5 overflow-y-auto rounded-xl p-1.5 scrollbar-hide [@media(max-height:860px)]:gap-1",
                    small ? "max-h-[60vh]" : ((className?.includes('max-h-') || className?.includes('h-full')) ? "max-h-full" : "max-h-[calc(100vh-10rem)]"),
                )}
            >
                <ToolbarGroup label="Annotation tools" className={SHORT_GAP}>
                    {TOOLS.map(tool => {
                        const Icon = tool.icon;
                        const isActive = annotationMode === tool.mode;
                        const color = tool.color?.(store);
                        return (
                            <Tooltip key={tool.mode} side="right" content={tool.label} shortcut={tool.shortcut} hint={tool.optionsHint}>
                                <DockButton
                                    compact={small}
                                    active={isActive}
                                    onClick={() => handleToolClick(tool.mode)}
                                    onDoubleClick={(event) => {
                                        event.preventDefault();
                                        handleDoubleClick(tool.mode);
                                    }}
                                    aria-label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                                >
                                    <Icon size={iconSize} strokeWidth={isActive ? 2.25 : 2} />
                                    {color && (
                                        // The current ink colour, like the colour bar under a
                                        // font-colour button. A hairline ring keeps white or
                                        // near-background colours visible.
                                        <span
                                            aria-hidden
                                            className={cn(
                                                'absolute bottom-1 left-1/2 h-[3px] w-3.5 -translate-x-1/2 rounded-full ring-1',
                                                isActive ? 'ring-text-onaccent/50' : 'ring-line',
                                            )}
                                            style={{ backgroundColor: color }}
                                        />
                                    )}
                                    {tool.optionsHint && tool.mode !== 'math' && (
                                        // A folded corner marks tools that have options.
                                        <span
                                            aria-hidden
                                            className={cn(
                                                'absolute bottom-[3px] right-[3px] size-0 border-b-[4px] border-l-[4px] border-l-transparent',
                                                isActive ? 'border-b-text-onaccent/70' : 'border-b-text-muted/60',
                                            )}
                                        />
                                    )}
                                </DockButton>
                            </Tooltip>
                        );
                    })}
                </ToolbarGroup>

                <ToolbarGroup label="Edit history" separated className={SHORT_GAP}>
                    <Tooltip side="right" content="Undo" shortcut="Mod+Z">
                        <DockButton compact={small} onClick={onUndo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)">
                            <Undo2 size={iconSize} />
                        </DockButton>
                    </Tooltip>
                    <Tooltip side="right" content="Redo" shortcut="Mod+Y">
                        <DockButton compact={small} onClick={onRedo} disabled={!canRedo} aria-label="Redo (Ctrl+Y)">
                            <Redo2 size={iconSize} />
                        </DockButton>
                    </Tooltip>
                </ToolbarGroup>

                <ToolbarGroup label="Zoom" separated className={SHORT_GAP}>
                    <Tooltip side="right" content="Zoom in">
                        <DockButton compact={small} onClick={() => setScale(Math.min(3, scale * 1.25))} disabled={scale >= 3} aria-label="Zoom in">
                            <ZoomIn size={iconSize} />
                        </DockButton>
                    </Tooltip>
                    <Tooltip side="right" content="Reset zoom to 100%">
                        <button
                            type="button"
                            onClick={() => setScale(1)}
                            aria-label={`Zoom ${zoomPercent}%, reset to 100%`}
                            className="h-6 w-9 rounded-md font-mono [@media(max-height:860px)]:h-5 text-[10px] font-medium tabular-nums text-text-muted transition-colors duration-state hover:bg-sunken hover:text-text"
                        >
                            {zoomPercent}%
                        </button>
                    </Tooltip>
                    <Tooltip side="right" content="Zoom out">
                        <DockButton compact={small} onClick={() => setScale(Math.max(0.5, scale / 1.25))} disabled={scale <= 0.5} aria-label="Zoom out">
                            <ZoomOut size={iconSize} />
                        </DockButton>
                    </Tooltip>
                </ToolbarGroup>

                <ToolbarGroup label="Save and layout" separated className={SHORT_GAP}>
                    <Tooltip side="right" content={effectiveIsModified ? 'Save — unsaved changes' : 'Save'} shortcut="Mod+S" hint="Double-click for export options">
                        <SaveButton
                            onSingleClick={() => onSave?.()}
                            onDoubleClick={() => onOpenSaveOptions?.()}
                            isModified={effectiveIsModified}
                            disabled={readOnly}
                            compact={small}
                        />
                    </Tooltip>
                    {onToggleReplicate && (
                        <Tooltip side="right" content={replicateToolbar ? 'One shared toolbar' : 'A toolbar in every pane'}>
                            <DockButton
                                compact={small}
                                onClick={onToggleReplicate}
                                active={replicateToolbar}
                                aria-label={replicateToolbar ? 'Merge toolbars' : 'Split toolbars'}
                            >
                                <Columns2 size={iconSize} />
                            </DockButton>
                        </Tooltip>
                    )}
                </ToolbarGroup>
            </div>

            {/* Popovers */}
            <SelectOptions isOpen={selectOptionsOpen} onClose={() => setSelectOptionsOpen(false)} />
            <HighlighterOptions isOpen={highlighterOptionsOpen} onClose={() => setHighlighterOptionsOpen(false)} />
            <EraserOptions isOpen={eraserOptionsOpen} onClose={() => setEraserOptionsOpen(false)} />
            <TextOptions isOpen={textOptionsOpen} onClose={() => setTextOptionsOpen(false)} />
            <ImageOptions isOpen={imageOptionsOpen} onClose={() => setImageOptionsOpen(false)} onImageSelect={onImageSelect || (() => { })} />

            {colorPickerOpen && (
                <ColorPicker
                    key={colorPickerOpen}
                    isOpen={true}
                    onClose={() => setColorPickerOpen(null)}
                    toolMode={colorPickerOpen}
                />
            )}
        </div>
    );
}
