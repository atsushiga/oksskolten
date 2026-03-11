import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Noto Sans',
          'Noto Sans JP',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // TeX Gyre Pagella is an open-source Palatino clone
        logo: ['TeX Gyre Pagella', 'Palatino', 'Palatino Linotype', 'Book Antiqua', 'Georgia', 'serif'],
      },
      colors: {
        // Existing project tokens
        bg: {
          DEFAULT: 'var(--color-bg)',
          card: 'var(--color-bg-card)',
          sidebar: 'var(--color-bg-sidebar)',
          header: 'var(--color-bg-header)',
          input: 'var(--color-bg-input)',
          subtle: 'var(--color-bg-subtle)',
          avatar: 'var(--color-bg-avatar)',
        },
        text: 'var(--color-text)',
        muted: 'var(--color-muted)',
        accent: {
          DEFAULT: 'var(--color-accent)',
          text: 'var(--color-accent-text)',
        },
        error: 'var(--color-error)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        overlay: 'var(--color-overlay)',
        border: 'var(--color-border)',
        hover: {
          DEFAULT: 'var(--color-hover)',
          sidebar: 'var(--color-hover-sidebar)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config
