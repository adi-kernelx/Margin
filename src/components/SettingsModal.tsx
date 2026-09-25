import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Database, Droplet, EyeOff, FileText, Info, Keyboard, Monitor, Moon, Palette, RefreshCw, Server, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useThemeStore, type ThemePreference } from '@/lib/theme/theme';
import { SERVICES, checkServiceNow, useServiceHealthStore, type ServiceHealth } from '@/lib/services/health';
import { selectCommands, useCommandStore } from '@/lib/commands/registry';
import { useUiStore, type SettingsSection } from '@/lib/ui/ui-store';
import { cn } from '@/lib/utils';
import { SERVICES_ENABLED } from '@/lib/features';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { SegmentedControl } from './ui/SegmentedControl';
import { Skeleton } from './ui/States';
import { ShortcutList } from './CommandLayer';

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

const sections: { id: SettingsSection; label: string; icon: ReactNode }[] = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={15} /> },
    ...(SERVICES_ENABLED ? [{ id: 'services' as const, label: 'Services', icon: <Server size={15} /> }] : []),
    { id: 'storage', label: 'Storage', icon: <Database size={15} /> },
    { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={15} /> },
    { id: 'about', label: 'About', icon: <Info size={15} /> },
];

function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="mb-4">
            <h3 className="text-md font-semibold text-text">{children}</h3>
            {hint && <p className="mt-0.5 text-sm text-text-muted">{hint}</p>}
        </div>
    );
}

function AppearanceSection() {
    const preference = useThemeStore(state => state.preference);
    const setPreference = useThemeStore(state => state.setPreference);
    const readingFilter = useAppStore(state => state.readingFilter);
    const setReadingFilter = useAppStore(state => state.setReadingFilter);
    return (
        <>
            <SectionTitle hint="The page itself always stays paper-white; filters only change how it is shown.">Appearance</SectionTitle>
            <div className="space-y-5">
                <SegmentedControl label="Theme" value={preference} options={themeOptions} onChange={(next) => setPreference(next as ThemePreference)} />
                <SegmentedControl label="Reading filter" value={readingFilter} options={readingFilterOptions} onChange={(next) => setReadingFilter(next as 'none' | 'dim' | 'sepia')} />
            </div>
        </>
    );
}

const healthText: Record<ServiceHealth, string> = { online: 'Online', offline: 'Offline', checking: 'Checking…' };
const healthStyle: Record<ServiceHealth, string> = {
    online: 'border-success bg-success-soft text-success',
    offline: 'border-danger bg-danger-soft text-danger',
    checking: 'border-line bg-sunken text-text-muted',
};

function ServicesSection() {
    const byKey = useServiceHealthStore(state => state.byKey);
    const lastCheckedAt = useServiceHealthStore(state => state.lastCheckedAt);
    return (
        <>
            <SectionTitle hint="Margin works fully offline. These optional local services add OCR and the assistant.">Services</SectionTitle>
            <div className="space-y-3">
                {SERVICES.map(service => {
                    const state = byKey[service.key];
                    return (
                        <div key={service.key} className="rounded-lg border border-line bg-surface-2 p-3 shadow-elev-1">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{service.label}</span>
                                        <span className={cn('rounded-sm border px-1.5 py-0.5 text-xs font-medium', healthStyle[state])}>{healthText[state]}</span>
                                    </div>
                                    <p className="mt-0.5 truncate font-mono text-xs text-text-muted">{service.healthUrl.replace(/\/health$/, '')}</p>
                                </div>
                                <Button size="sm" leadingIcon={<RefreshCw size={13} className={state === 'checking' ? 'animate-spin' : undefined} />} disabled={state === 'checking'} onClick={() => void checkServiceNow(service.key)}>
                                    Test connection
                                </Button>
                            </div>
                            <p className="mt-2 text-xs text-text-muted">
                                Provides {service.provides}.
                                {lastCheckedAt[service.key] > 0 && ` Last checked ${new Date(lastCheckedAt[service.key]).toLocaleTimeString()}.`}
                            </p>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function StorageSection() {
    const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null | 'unsupported'>(null);
    const [persisted, setPersisted] = useState<boolean | null>(null);
    const [requesting, setRequesting] = useState(false);

    useEffect(() => {
        const storage = navigator.storage;
        if (!storage?.estimate) {
            setEstimate('unsupported');
            return;
        }
        void storage.estimate().then(result => setEstimate({ usage: result.usage ?? 0, quota: result.quota ?? 0 }));
        void storage.persisted?.().then(setPersisted);
    }, []);

    const requestPersist = async () => {
        setRequesting(true);
        try {
            setPersisted(await navigator.storage.persist());
        } finally {
            setRequesting(false);
        }
    };

    const fraction = estimate && estimate !== 'unsupported' && estimate.quota ? estimate.usage / estimate.quota : 0;

    return (
        <>
            <SectionTitle hint="Documents, annotations and notes live in this browser's storage on this machine.">Storage</SectionTitle>
            <div className="space-y-4">
                <div className="rounded-lg border border-line bg-surface-2 p-3 shadow-elev-1">
                    {estimate === null && <Skeleton lines={2} />}
                    {estimate === 'unsupported' && <p className="text-sm text-text-muted">This browser does not report storage usage.</p>}
                    {estimate && estimate !== 'unsupported' && (
                        <>
                            <div className="flex items-baseline justify-between text-sm">
                                <span className="font-medium">{formatBytes(estimate.usage)} used</span>
                                <span className="text-text-muted">of about {formatBytes(estimate.quota)}</span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sunken shadow-[var(--edge-press)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Storage used">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(1, Math.min(100, fraction * 100))}%` }} />
                            </div>
                        </>
                    )}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 p-3 shadow-elev-1">
                    <div>
                        <div className="text-sm font-medium">Keep data persistent</div>
                        <p className="text-xs text-text-muted">
                            {persisted ? 'Granted — the browser will not evict Margin’s data under storage pressure.' : 'Ask the browser not to clear Margin’s data when disk space runs low.'}
                        </p>
                    </div>
                    <Button size="sm" variant={persisted ? 'ghost' : 'primary'} disabled={Boolean(persisted) || requesting || !navigator.storage?.persist} onClick={() => void requestPersist()}>
                        {persisted ? 'Persistent' : 'Request'}
                    </Button>
                </div>
            </div>
        </>
    );
}

function ShortcutsSection() {
    const sources = useCommandStore(state => state.sources);
    const commands = useMemo(() => selectCommands(sources).filter(command => command.shortcut), [sources]);
    return (
        <>
            <SectionTitle hint="Press ? anywhere to see this list, or Ctrl+K to search every action.">Shortcuts</SectionTitle>
            <ShortcutList commands={commands} />
        </>
    );
}

function AboutSection() {
    return (
        <>
            <SectionTitle>About</SectionTitle>
            <div className="rounded-lg border border-line bg-accent-soft p-4">
                <h4 className="font-semibold text-accent">Margin v0.1</h4>
                <p className="mt-1 text-sm leading-relaxed text-text-soft">
                    A local-first reading and annotation workspace for mathematical documents. No accounts, no uploads —
                    your files and notes stay on this machine.
                </p>
            </div>
        </>
    );
}

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const section = useUiStore(state => state.settingsSection);
    const setSection = useUiStore(state => state.setSettingsSection);

    return (
        <Dialog open={isOpen} title="Settings" icon={<SettingsIcon size={16} />} onClose={onClose} size="lg" bodyClassName="p-0" footer={<Button onClick={onClose}>Close</Button>}>
            <div className="grid min-h-[380px] sm:grid-cols-[180px_1fr]">
                <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-line-soft bg-surface-2 p-2 sm:flex-col sm:border-b-0 sm:border-r">
                    {sections.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            aria-current={section === item.id ? 'page' : undefined}
                            onClick={() => setSection(item.id)}
                            className={cn(
                                'flex h-9 shrink-0 items-center gap-2 rounded px-3 text-left text-sm transition-colors duration-state',
                                section === item.id ? 'bg-surface-3 font-semibold text-accent shadow-elev-1' : 'text-text-soft hover:bg-sunken hover:text-text',
                            )}
                        >
                            {item.icon}{item.label}
                        </button>
                    ))}
                </nav>
                <div className="p-5">
                    {section === 'appearance' && <AppearanceSection />}
                    {SERVICES_ENABLED && section === 'services' && <ServicesSection />}
                    {section === 'storage' && <StorageSection />}
                    {section === 'shortcuts' && <ShortcutsSection />}
                    {section === 'about' && <AboutSection />}
                </div>
            </div>
        </Dialog>
    );
}
