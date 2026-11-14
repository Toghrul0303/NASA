import type { Config } from 'tailwindcss'

/**
 * Chrome colours are the migrated prototype (black field, lime accent).
 * Scientific palettes are the design tokens from FRONTEND_SPEC §15.3.
 * Verdict green / blue / grey use the Okabe-Ito colours from that palette;
 * amber uses the contamination amber.
 */
const epoch = {
  0: 'var(--epoch-0)',
  1: 'var(--epoch-1)',
  2: 'var(--epoch-2)',
  3: 'var(--epoch-3)',
  4: 'var(--epoch-4)',
  5: 'var(--epoch-5)',
  6: 'var(--epoch-6)',
  7: 'var(--epoch-7)',
} as const

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#000000',
        foreground: '#ffffff',
        accent: {
          DEFAULT: '#F0FF3C',
          pale: 'rgba(240, 255, 60, 0.14)',
          border: 'rgba(240, 255, 60, 0.28)',
        },
        primary: {
          DEFAULT: 'var(--ws-primary)',
          foreground: 'var(--ws-primary-fg)',
        },
        ws: {
          bg: 'var(--ws-bg)',
          fg: 'var(--ws-fg)',
          border: 'var(--ws-border)',
          muted: 'var(--ws-muted)',
          primary: 'var(--ws-primary)',
        },
        secondary: {
          DEFAULT: 'rgba(255, 255, 255, 0.1)',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: '#111111',
          foreground: 'rgba(255, 255, 255, 0.6)',
        },
        border: 'rgba(255, 255, 255, 0.1)',
        input: 'rgba(255, 255, 255, 0.15)',
        ring: 'rgba(255, 255, 255, 0.55)',
        mask: 'var(--mask)',
        neutral: {
          DEFAULT: 'var(--neutral)',
        },
        contamination: {
          neutral: 'var(--contamination-neutral)',
          amber: 'var(--contamination-amber)',
          red: 'var(--contamination-red)',
        },
        verdict: {
          consistent: '#009E73',
          inconsistent: '#F5A524',
          none: '#56B4E9',
          unavailable: '#999999',
        },
        diverging: {
          low: 'var(--diverging-low)',
          mid: 'var(--diverging-mid)',
          high: 'var(--diverging-high)',
        },
        epoch,
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '1.5rem',
        xl: '1.5rem',
      },
    },
  },
  plugins: [],
} satisfies Config
