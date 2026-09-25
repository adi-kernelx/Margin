import { useState } from 'react';
import { Info, X } from 'lucide-react';

const STORAGE_KEY = 'margin:demo-banner-dismissed';

function readDismissed(): boolean {
    try {
        return window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * A slim strip under the header in the demo build. Dismissal lasts for the
 * browser session only, so a returning visitor is reminded again.
 */
export function DemoBanner() {
    const [dismissed, setDismissed] = useState(readDismissed);
    if (dismissed) return null;
    return (
        <div role="note" className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-line bg-accent-soft px-4 text-xs text-text-soft">
            <Info size={13} className="shrink-0 text-accent" />
            <span className="truncate">
                <strong className="font-semibold text-accent">Demo.</strong> Everything you open or write stays in this browser — nothing is uploaded. OCR and the assistant need the local services and are off here.
            </span>
            <button
                type="button"
                aria-label="Dismiss demo notice"
                className="ml-2 grid size-6 shrink-0 place-items-center rounded text-text-muted hover:bg-surface-2 hover:text-text"
                onClick={() => {
                    setDismissed(true);
                    try {
                        window.sessionStorage.setItem(STORAGE_KEY, '1');
                    } catch {
                        // Non-essential.
                    }
                }}
            >
                <X size={13} />
            </button>
        </div>
    );
}
