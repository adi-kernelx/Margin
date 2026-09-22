import { Info, Monitor, Moon, Sun, Droplet, FileText, EyeOff } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useThemeStore, type ThemePreference } from '@/lib/theme/theme';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { SegmentedControl } from './ui/SegmentedControl';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const themeOptions = [
    { value: 'system', label: 'System', icon: <Monitor size={14} /> },
    { value: 'light',  label: 'Light',  icon: <Sun size={14} /> },
    { value: 'dark',   label: 'Dark',   icon: <Moon size={14} /> },
] as const;

const readingFilterOptions = [
    { value: 'none',  label: 'Off',   icon: <EyeOff size={14} /> },
    { value: 'dim',   label: 'Dim',   icon: <Droplet size={14} /> },
    { value: 'sepia', label: 'Sepia', icon: <FileText size={14} /> },
] as const;

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const preference = useThemeStore(state => state.preference);
    const setPreference = useThemeStore(state => state.setPreference);
    const readingFilter = useAppStore(state => state.readingFilter);
    const setReadingFilter = useAppStore(state => state.setReadingFilter);

    return (
        <Dialog open={isOpen} title="Settings" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
            <div className="space-y-5">
                <SegmentedControl
                    label="Appearance"
                    value={preference}
                    options={themeOptions}
                    onChange={(next) => setPreference(next as ThemePreference)}
                />
                <SegmentedControl
                    label="Reading filter"
                    value={readingFilter}
                    options={readingFilterOptions}
                    onChange={(next) => setReadingFilter(next as 'none' | 'dim' | 'sepia')}
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
