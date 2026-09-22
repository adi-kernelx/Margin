// Dev-only design gallery.
//
// Rendered when the URL carries `?gallery`. Excluded from production because
// App.tsx guards its import behind `import.meta.env.DEV`. The gallery is the
// review surface for every subsequent frontend phase: whenever a phase adds
// a primitive, a variant, or a depth utility, it lands here first so a human
// can look at it in isolation before it appears inside a real screen.

import { useMemo, useState } from 'react';
import { useThemeStore, type ThemePreference } from '@/lib/theme/theme';
import { usePointerTilt } from '@/lib/ui/usePointerTilt';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

function ThemeControls() {
    const preference = useThemeStore(state => state.preference);
    const setPreference = useThemeStore(state => state.setPreference);
    const resolved = useThemeStore(state => state.resolved);
    return (
        <section aria-label="Theme">
            <h2 style={{ fontFamily: 'var(--font-sans)' }}>Theme</h2>
            <p style={{ color: 'var(--text-muted)' }}>
                Current preference: <code>{preference}</code> → resolved{' '}
                <code>{resolved}</code>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
                {THEMES.map(option => (
                    <button
                        key={option}
                        onClick={() => setPreference(option)}
                        className="depth-pressable"
                        style={{
                            padding: '6px 12px',
                            border: 'none',
                            font: 'inherit',
                            color: 'var(--text)',
                            fontWeight: option === preference ? 600 : 400,
                        }}
                    >
                        {option}
                    </button>
                ))}
            </div>
        </section>
    );
}

function Elevations() {
    return (
        <section aria-label="Elevation">
            <h2 style={{ fontFamily: 'var(--font-sans)' }}>Elevation</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24, marginTop: 12 }}>
                {[1, 2, 3, 4].map(level => (
                    <div
                        key={level}
                        style={{
                            padding: 24,
                            borderRadius: 'var(--radius)',
                            background: 'var(--surface-2)',
                            backgroundImage: 'var(--surface-raised-fill)',
                            boxShadow: `var(--elev-${level}), var(--edge-highlight)`,
                            color: 'var(--text)',
                        }}
                    >
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                            elev-{level}
                        </div>
                        <div style={{ marginTop: 6 }}>The quick brown fox</div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function TypographyStack() {
    return (
        <section aria-label="Typography">
            <h2 style={{ fontFamily: 'var(--font-sans)' }}>Typography</h2>
            <div style={{ fontFamily: 'var(--font-sans)', display: 'grid', gap: 8, color: 'var(--text)' }}>
                <div style={{ fontSize: 'var(--text-2xl)' }}>2xl — Plus Jakarta Sans</div>
                <div style={{ fontSize: 'var(--text-xl)' }}>xl</div>
                <div style={{ fontSize: 'var(--text-lg)' }}>lg</div>
                <div style={{ fontSize: 'var(--text-md)' }}>md</div>
                <div style={{ fontSize: 'var(--text-base)' }}>base — body copy</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>sm — muted</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                    mono — 0O 1lI — Ctrl+K
                </div>
            </div>
        </section>
    );
}

function TiltCard() {
    const { ref, onPointerMove, onPointerEnter, onPointerLeave, onBlur } = usePointerTilt<HTMLButtonElement>();
    return (
        <button
            ref={ref}
            onPointerMove={onPointerMove}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onBlur={onBlur}
            className="depth-tilt depth-float"
            style={{
                width: 240,
                height: 320,
                padding: 20,
                border: 'none',
                color: 'var(--text)',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'var(--surface-3)',
                backgroundImage: 'var(--surface-raised-fill)',
            }}
        >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                depth-tilt on depth-float
            </div>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-lg)' }}>
                Move the pointer.
            </div>
        </button>
    );
}

function StackedPaper() {
    return (
        <div
            className="depth-stack"
            style={{
                width: 240,
                height: 320,
                padding: 20,
                borderRadius: 'var(--radius-lg)',
                background: 'var(--surface-3)',
                backgroundImage: 'var(--surface-raised-fill)',
                boxShadow: 'var(--elev-2), var(--edge-highlight)',
                color: 'var(--text)',
            }}
        >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                depth-stack
            </div>
            <div style={{ marginTop: 8, fontFamily: 'var(--font-sans)', fontSize: 'var(--text-lg)' }}>
                Three sheets, one card.
            </div>
        </div>
    );
}

function AnnotationSwatches() {
    const highlighters = [
        ['hl-yellow', 'var(--hl-yellow)'],
        ['hl-pink',   'var(--hl-pink)'],
        ['hl-green',  'var(--hl-green)'],
        ['hl-blue',   'var(--hl-blue)'],
        ['hl-orange', 'var(--hl-orange)'],
    ] as const;
    const inks = [
        ['ink-black', 'var(--ink-black)'],
        ['ink-blue',  'var(--ink-blue)'],
        ['ink-red',   'var(--ink-red)'],
    ] as const;
    return (
        <section aria-label="Annotation palette">
            <h2 style={{ fontFamily: 'var(--font-sans)' }}>Annotation palette (theme-invariant)</h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                {[...highlighters, ...inks].map(([name, colour]) => (
                    <div key={name} style={{ textAlign: 'center' }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 'var(--radius)',
                            background: colour, boxShadow: 'var(--elev-1)',
                        }} />
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                            {name}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

export default function DesignGallery() {
    const [reduce, setReduce] = useState(false);

    // Apply the reduced-motion preview by stamping a class on the root; not a
    // real media-query change, but it flips every rule that reads --tilt-max
    // etc. through the tokens.
    const rootStyle = useMemo(() => reduce
        ? ({ '--tilt-max': '0deg', '--lift': '0px' } as React.CSSProperties)
        : ({} as React.CSSProperties),
    [reduce]);

    return (
        <div style={{
            background: 'var(--ground)',
            color: 'var(--text)',
            minHeight: '100vh',
            padding: 40,
            fontFamily: 'var(--font-sans)',
            ...rootStyle,
        }}>
            <header style={{ marginBottom: 32 }}>
                <h1 style={{ margin: 0 }}>Margin design gallery</h1>
                <p style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                    Dev-only. Toggle the theme in the controls below; toggle reduced
                    motion here to preview the accessible state.
                </p>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={reduce} onChange={event => setReduce(event.target.checked)} />
                    Simulate prefers-reduced-motion
                </label>
            </header>

            <div style={{ display: 'grid', gap: 40, gridTemplateColumns: '1fr' }}>
                <ThemeControls />
                <Elevations />
                <TypographyStack />
                <section aria-label="Depth utilities">
                    <h2 style={{ fontFamily: 'var(--font-sans)' }}>Depth: tilt and stack</h2>
                    <div style={{ display: 'flex', gap: 32, marginTop: 16, alignItems: 'flex-start' }}>
                        <TiltCard />
                        <StackedPaper />
                    </div>
                </section>
                <AnnotationSwatches />
            </div>
        </div>
    );
}
