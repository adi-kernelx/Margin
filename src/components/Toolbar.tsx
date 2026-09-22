import { useState, useRef } from 'react';
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
    ZoomOut
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
import { IconButton } from './ui/IconButton';
import { ToolbarGroup } from './ui/ToolbarGroup';
import { Tooltip } from './ui/Tooltip';
import type { ToolMode } from '@/lib/store';

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
    const { annotationMode, setAnnotationMode, isDirty, setMathModalOpen, setScale, scale } = useDocumentStore();
    const [highlighterOptionsOpen, setHighlighterOptionsOpen] = useState(false);
    const effectiveIsModified = isModified !== undefined ? isModified : isDirty;

    const [eraserOptionsOpen, setEraserOptionsOpen] = useState(false);
    const [textOptionsOpen, setTextOptionsOpen] = useState(false);
    const [imageOptionsOpen, setImageOptionsOpen] = useState(false);
    const [selectOptionsOpen, setSelectOptionsOpen] = useState(false);
    const [colorPickerOpen, setColorPickerOpen] = useState<'pencil' | 'rectangle' | 'arrow' | null>(null);
    const clickTimeoutRef = useRef<Partial<Record<NonNullable<ToolMode>, ReturnType<typeof setTimeout>>>>({});

    const tools = [
        { icon: MousePointer2, mode: 'select' as const, label: 'Select (V)' },
        { icon: Pencil, mode: 'pencil' as const, label: 'Pencil (P) - Double-click for color' },
        { icon: Highlighter, mode: 'highlighter' as const, label: 'Highlighter (H)' },
        { icon: Type, mode: 'text' as const, label: 'Text (T)' },
        { icon: Eraser, mode: 'eraser' as const, label: 'Eraser (E)' },
        { icon: Square, mode: 'rectangle' as const, label: 'Rectangle (R) - Double-click for color' },
        { icon: ArrowRight, mode: 'arrow' as const, label: 'Arrow (A) - Double-click for color' },
        { icon: ImageIcon, mode: 'image' as const, label: 'Image (I) - Click to paste, Double-click to upload' },
        { icon: Calculator, mode: 'math' as const, label: 'Math Equation' },
    ];

    const handleToolClick = (mode: NonNullable<ToolMode>) => {
        // Clear any existing timeout for this tool
        if (clickTimeoutRef.current[mode]) {
            clearTimeout(clickTimeoutRef.current[mode]!);
            delete clickTimeoutRef.current[mode];
        }

        // Set a timeout to handle single click (wait to see if double click occurs)
        clickTimeoutRef.current[mode] = setTimeout(() => {
            // Single click: toggle tool on/off, close any open popovers
            if (annotationMode === mode) {
                // Special case for Math: Click on active tool opens modal
                if (mode === 'math') {
                    setMathModalOpen(true);
                } else {
                    // Deselect current tool
                    setAnnotationMode(null);
                }
            } else {
                // Select new tool
                setAnnotationMode(mode);
                if (mode === 'select') {
                    // Ensure we have a valid selection mode if not set?
                    // Store initializes it to 'text'.
                    // If user switches to Select tool, we should respect current selectionMode.
                }
            }
            // Always close popovers on single click
            setHighlighterOptionsOpen(false);
            setEraserOptionsOpen(false);
            setTextOptionsOpen(false);
            setImageOptionsOpen(false);
            setSelectOptionsOpen(false);
            setColorPickerOpen(null);
            delete clickTimeoutRef.current[mode];
        }, 300); // 300ms delay to detect double click
    };

    const handleDoubleClick = (mode: NonNullable<ToolMode>) => {
        // Clear the single click timeout
        if (clickTimeoutRef.current[mode]) {
            clearTimeout(clickTimeoutRef.current[mode]!);
            delete clickTimeoutRef.current[mode];
        }

        // Close all other popovers first
        setHighlighterOptionsOpen(false);
        setEraserOptionsOpen(false);
        setTextOptionsOpen(false);
        setImageOptionsOpen(false);
        setSelectOptionsOpen(false);
        setColorPickerOpen(null);

        // Double click: open options popover for specific tools
        if (mode === 'select') {
            setAnnotationMode('select'); // Ensure active
            setSelectOptionsOpen(true);
        } else if (mode === 'highlighter') {
            setAnnotationMode('highlighter'); // Ensure active
            setHighlighterOptionsOpen(true);
        } else if (mode === 'eraser') {
            setAnnotationMode('eraser'); // Ensure active
            setEraserOptionsOpen(true);
        } else if (mode === 'text') {
            setAnnotationMode('text'); // Ensure active
            setTextOptionsOpen(true);
        } else if (mode === 'image') {
            setAnnotationMode('image'); // Ensure active
            setImageOptionsOpen(true);
        } else if (mode === 'pencil') {
            setAnnotationMode('pencil'); // Ensure active
            setColorPickerOpen('pencil');
        } else if (mode === 'rectangle') {
            setAnnotationMode('rectangle'); // Ensure active
            setColorPickerOpen('rectangle');
        } else if (mode === 'arrow') {
            setAnnotationMode('arrow'); // Ensure active
            setColorPickerOpen('arrow');
        } else if (mode === 'math') {
            setAnnotationMode('math');
            setMathModalOpen(true);
        }
    };

    return (
        <div className={cn(
            "flex flex-col z-10",
            !className && "absolute left-6 top-6", // Default if no class provided
            className
        )}>
            <div className={cn(
                // The tool dock is the app's one glass surface: a shallow
                // backdrop-blur pill floating above the page. The blur is
                // rationed per §06 of the plan — dialog scrims use a plain
                // dim instead.
                "depth-glass p-2 flex flex-col gap-2 overflow-y-auto scrollbar-hide",
                small ? "max-h-[60vh] scale-90 origin-top-left" : ((className?.includes('max-h-') || className?.includes('h-full')) ? "max-h-full" : "max-h-[80vh]"),
            )}>
                {/* Drawing Tools */}
                <ToolbarGroup label="Annotation tools">
                    {tools.map((tool) => {
                        const Icon = tool.icon;
                        const isActive = annotationMode === tool.mode;

                        return (
                            <IconButton
                                key={tool.mode}
                                size="lg"
                                pressed={isActive}
                                onClick={() => handleToolClick(tool.mode)}
                                onDoubleClick={(event) => {
                                    event.preventDefault();
                                    handleDoubleClick(tool.mode);
                                }}
                                aria-label={tool.label}
                                title={tool.label}
                            >
                                <Icon size={20} />
                            </IconButton>
                        );
                    })}
                </ToolbarGroup>

                {/* Save / Export */}
                <ToolbarGroup label="Save and export" separated>
                    <SaveButton
                        onSingleClick={() => onSave?.()}
                        onDoubleClick={() => onOpenSaveOptions?.()}
                        isModified={effectiveIsModified}
                        disabled={readOnly}
                        className=""
                    />
                </ToolbarGroup>

                {/* Undo/Redo */}
                <ToolbarGroup label="Edit history" separated>
                    <IconButton size="lg" onClick={onUndo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">
                        <Undo2 size={20} />
                    </IconButton>
                    <IconButton size="lg" onClick={onRedo} disabled={!canRedo} aria-label="Redo (Ctrl+Y)" title="Redo (Ctrl+Y)">
                        <Redo2 size={20} />
                    </IconButton>
                </ToolbarGroup>

                {/* Zoom Controls */}
                <ToolbarGroup label="Zoom" separated>
                    <Tooltip content="Zoom in (Ctrl +)">
                        <IconButton size={small ? 'md' : 'lg'} onClick={() => setScale(Math.min(3, scale * 1.25))} aria-label="Zoom in (Ctrl +)">
                            <ZoomIn size={small ? 16 : 20} />
                        </IconButton>
                    </Tooltip>
                    <Tooltip content="Zoom out (Ctrl -)">
                        <IconButton size={small ? 'md' : 'lg'} onClick={() => setScale(Math.max(0.5, scale / 1.25))} aria-label="Zoom out (Ctrl -)">
                            <ZoomOut size={small ? 16 : 20} />
                        </IconButton>
                    </Tooltip>
                </ToolbarGroup>

                {onToggleReplicate && (
                    <ToolbarGroup label="Pane toolbar" separated>
                        <IconButton
                            size={small ? 'md' : 'lg'}
                            onClick={onToggleReplicate}
                            pressed={replicateToolbar}
                            aria-label={replicateToolbar ? "Merge toolbars" : "Split toolbars"}
                            title={replicateToolbar ? "Merge Toolbars" : "Split Toolbars"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width={small ? 16 : 20} height={small ? 16 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="18" x="3" y="3" rx="1" /><path d="M15 3v18" /></svg>
                        </IconButton>
                    </ToolbarGroup>
                )}

            </div>

            {/* Popovers */}
            <SelectOptions isOpen={selectOptionsOpen} onClose={() => setSelectOptionsOpen(false)} />
            <HighlighterOptions isOpen={highlighterOptionsOpen} onClose={() => setHighlighterOptionsOpen(false)} />
            <EraserOptions isOpen={eraserOptionsOpen} onClose={() => setEraserOptionsOpen(false)} />
            <TextOptions isOpen={textOptionsOpen} onClose={() => setTextOptionsOpen(false)} />
            <ImageOptions isOpen={imageOptionsOpen} onClose={() => setImageOptionsOpen(false)} onImageSelect={onImageSelect || (() => { })} />

            {/* Color Pickers */}
            {colorPickerOpen === 'pencil' && (
                <ColorPicker
                    isOpen={true}
                    onClose={() => setColorPickerOpen(null)}
                    toolMode="pencil"
                />
            )}
            {colorPickerOpen === 'rectangle' && (
                <ColorPicker
                    isOpen={true}
                    onClose={() => setColorPickerOpen(null)}
                    toolMode="rectangle"
                />
            )}
            {colorPickerOpen === 'arrow' && (
                <ColorPicker
                    isOpen={true}
                    onClose={() => setColorPickerOpen(null)}
                    toolMode="arrow"
                />
            )}
        </div>
    );
}
