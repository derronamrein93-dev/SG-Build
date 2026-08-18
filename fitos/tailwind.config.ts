import type { Config } from 'tailwindcss';

/** Tokens from docs/08 — the interface is calm; the data is vivid. */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { base: '#F7F6F3', raised: '#FFFFFF', sunken: '#EFEDE7' },
        line: { DEFAULT: '#E2DFD8', strong: '#CDC9C0' },
        ink: { DEFAULT: '#14181B', secondary: '#4E575E', muted: '#6E7981' },
        accent: { DEFAULT: '#0F5C5B', hover: '#0B4746', wash: '#E4EFEE' },
        sand: '#E9E3D6',
        success: '#1F7A5A', attention: '#9A6414', alert: '#A6342B',
        scan: { bg: '#0E1214', surface: '#161C1F', line: '#232B2F', ink: '#F2F4F3' },
      },
      borderRadius: { card: '10px', control: '8px' },
      boxShadow: { sheet: '0 4px 16px rgba(20,24,27,.08)' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      spacing: { touch: '56px' },
    },
  },
  plugins: [],
} satisfies Config;
