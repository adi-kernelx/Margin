/** @type {import('tailwindcss').Config} */

// Every value here resolves to a custom property defined in src/styles/tokens.css.
// Tailwind is a way to reference the tokens, never a second place to define them
// — so `bg-surface-2` and `var(--surface-2)` can never drift apart.
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ground: "var(--ground)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
          4: "var(--surface-4)",
        },
        sunken: "var(--sunken)",
        line: {
          DEFAULT: "var(--line)",
          soft: "var(--line-soft)",
        },
        text: {
          DEFAULT: "var(--text)",
          soft: "var(--text-soft)",
          muted: "var(--text-muted)",
          onaccent: "var(--text-on-accent)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
        },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
        success: { DEFAULT: "var(--success)", soft: "var(--success-soft)" },

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
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        7: "var(--space-7)",
        8: "var(--space-8)",
      },
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
