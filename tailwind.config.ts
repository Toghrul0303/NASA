import type { Config } from 'tailwindcss'

/**
 * Chrome colours are the migrated prototype (black field, lime accent).
 * Scientific palettes are the design tokens from FRONTEND_SPEC §15.3.
 * Verdict green / blue / grey use the Okabe-Ito colours from that palette;
 * amber uses the contamination amber.
 */
const epoch = {
  0: '#E69F00',
  1: '#56B4E9',
  2: '#009E73',
  3: '#F0E442',
  4: '#0072B2',
  5: '#D55E00',
  6: '#CC79A7',
  7: '#999999',
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
          DEFAULT: '#F0FF3C',
          foreground: '#000000',
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
        mask: '#2B2F3A',
        contamination: {
          neutral: '#9AA4B2',
          amber: '#F5A524',
          red: '#E5484D',
        },
        verdict: {
          consistent: '#009E73',
          inconsistent: '#F5A524',
          none: '#56B4E9',
          unavailable: '#999999',
        },
        diverging: {
          low: '#2B6CB0',
          mid: '#E5E7EB',
          high: '#DD6B20',
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
