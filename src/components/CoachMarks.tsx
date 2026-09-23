import { useState } from 'react';
import { FolderPlus, Highlighter, LayoutGrid, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { KeyCaps } from './CommandLayer';

const STORAGE_KEY = 'margin:coach-marks:v1';

const steps = [
    {
        icon: <FolderPlus size={18} />,
        title: 'Import',
        body: 'Drop PDFs onto the library or use “Open & add”. Files are referenced, never uploaded.',
    },
    {
        icon: <Highlighter size={18} />,
        title: 'Annotate',
        body: 'Pick a tool from the floating dock — P pencil, H highlighter, T text. Notes can link many highlights.',
    },
    {
        icon: <LayoutGrid size={18} />,
        title: 'Organise',
        body: 'Open “Pages” to reorder, rotate, split or merge. Alt + arrows move a page without dragging.',
    },
] as const;

function readDismissed(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'done';
    } catch {
        return true;
    }
}

/**
 * First-run tour: three steps in a floating card. Remembered locally once
 * dismissed or finished; never shown again unless storage is cleared.
 */
export function CoachMarks() {
    const [dismissed, setDismissed] = useState(readDismissed);
    const [step, setStep] = useState(0);

    if (dismissed) return null;

    const finish = () => {
        setDismissed(true);
        try {
            window.localStorage.setItem(STORAGE_KEY, 'done');
        } catch {
            // Storage unavailable: the tour simply shows again next time.
        }
    };

    const current = steps[step];
    const last = step === steps.length - 1;

    return (
        <aside
            aria-label="Getting started"
            className="depth-overlay fixed bottom-12 right-4 z-popover w-80 border border-line p-4 animate-[dialog-in_var(--dur-entrance)_var(--ease)]"
        >
            <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{current.icon}</span>
                <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Step {step + 1} of {steps.length}</p>
                    <h2 className="font-semibold text-text">{current.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-text-soft">{current.body}</p>
                </div>
                <IconButton size="sm" aria-label="Dismiss getting started" onClick={finish}><X size={14} /></IconButton>
            </div>
            <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-1.5" aria-hidden="true">
                    {steps.map((_, index) => <span key={index} className={cn('h-1.5 rounded-full transition-all duration-surface', index === step ? 'w-5 bg-accent' : 'w-1.5 bg-line')} />)}
                </div>
                <div className="flex items-center gap-2">
                    {last && <span className="hidden items-center gap-1 text-xs text-text-muted sm:flex"><KeyCaps shortcut="Mod+K" /> for everything</span>}
                    <Button size="sm" variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'Got it' : 'Next'}</Button>
                </div>
            </div>
        </aside>
    );
}
