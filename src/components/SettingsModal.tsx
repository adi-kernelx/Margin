import { Info, Moon, Sun } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { SegmentedControl } from './ui/SegmentedControl';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const themeOptions = [
    { value: 'light', label: 'Light', icon: <Sun size={14} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
] as const;

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { isDarkMode, toggleDarkMode } = useAppStore();
    const theme = isDarkMode ? 'dark' : 'light';

    return (
        <Dialog open={isOpen} title="Settings" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
            <div className="space-y-5">
                <SegmentedControl
                    label="Appearance"
                    value={theme}
                    options={themeOptions}
                    onChange={(nextTheme) => {
                        if (nextTheme !== theme) toggleDarkMode();
                    }}
                />
                <section className="rounded-lg border border-line bg-accent-soft p-3" aria-labelledby="about-margin">
                    <div className="flex items-start gap-3">
                        <Info size={18} className="mt-0.5 shrink-0 text-accent" />
                        <div>
                            <h3 id="about-margin" className="text-sm font-semibold text-accent">Margin v0.1</h3>
                            <p className="mt-1 text-xs leading-relaxed text-text-soft">
                                A local-first reading and annotation workspace for mathematical documents.
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </Dialog>
    );
}
