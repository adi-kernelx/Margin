/** @type {import('tailwindcss').Config} */

// Every value here resolves to a custom property defined in src/styles/tokens.css.
// Tailwind is a way to reference the tokens, never a second place to define them
// — so `bg-surface-2` and `var(--surface-2)` can never drift apart.
// Token colours go through color-mix so Tailwind's opacity modifier works on
// them: `bg-accent-soft/70` becomes 70% of the token over transparent. A plain
// `var(--x)` value cannot take an alpha, and Tailwind 3 silently drops the class.
const token = (name) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ground: token("ground"),
        surface: {
          1: token("surface-1"),
          2: token("surface-2"),
          3: token("surface-3"),
          4: token("surface-4"),
        },
        sunken: token("sunken"),
        line: {
          DEFAULT: token("line"),
          soft: token("line-soft"),
        },
        text: {
          DEFAULT: token("text"),
          soft: token("text-soft"),
          muted: token("text-muted"),
          onaccent: token("text-on-accent"),
        },
        accent: {
          DEFAULT: token("accent"),
          hover: token("accent-hover"),
          soft: token("accent-soft"),
        },
        danger: { DEFAULT: token("danger"), soft: token("danger-soft") },
        warning: { DEFAULT: token("warning"), soft: token("warning-soft") },
        success: { DEFAULT: token("success"), soft: token("success-soft") },

        // Annotation palette — theme-invariant. A yellow highlight is content
        // the user drew and stays the same colour in both themes; the UI
        // accent is deliberately kept clear of every one of these.
        hl: {
          yellow: token("hl-yellow"),
          pink:   token("hl-pink"),
          green:  token("hl-green"),
          blue:   token("hl-blue"),
          orange: token("hl-orange"),
        },
        ink: {
          black: token("ink-black"),
          blue:  token("ink-blue"),
          red:   token("ink-red"),
        },

        // Retained so the pre-token components keep rendering during migration.
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
      },
      boxShadow: {
        'elev-1': "var(--elev-1)",
        'elev-2': "var(--elev-2)",
        'elev-3': "var(--elev-3)",
        'elev-4': "var(--elev-4)",
        edge: "var(--edge-highlight)",
        page: "var(--page-shadow)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      fontSize: {
        xs: "var(--text-xs)",
        sm: "var(--text-sm)",
        base: "var(--text-base)",
        md: "var(--text-md)",
        lg: "var(--text-lg)",
        xl: "var(--text-xl)",
        '2xl': "var(--text-2xl)",
      },
      // No `spacing` override: Tailwind's numeric scale (h-8 = 32px, p-6 =
      // 24px) is what every component is written against. Mapping 5–8 to the
      // --space-* tokens (24/32/48/64px) silently doubled sizes like
      // size-8 and h-8. The tokens stay available for plain CSS.
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      transitionDuration: {
        state: "var(--dur-state)",
        surface: "var(--dur-surface)",
        entrance: "var(--dur-entrance)",
      },
      transitionTimingFunction: {
        DEFAULT: "var(--ease)",
      },
      zIndex: {
        page: "var(--z-page)",
        chrome: "var(--z-chrome)",
        panel: "var(--z-panel)",
        popover: "var(--z-popover)",
        dialog: "var(--z-dialog)",
      },
    },
  },
  plugins: [],
}
