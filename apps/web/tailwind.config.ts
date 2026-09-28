import type { Config } from 'tailwindcss';

/** Rupeemap palette, taken from the logo: ink black, growth teal, chart red, coin gold. */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#111412', 900: '#111412', 800: '#1d221f', 700: '#2c332f', 600: '#4a534e', 500: '#6b746f', 400: '#9aa29d', 300: '#c9cfcb', 200: '#e3e7e4', 100: '#f0f2f0', 50: '#f7f8f7' },
        teal: { DEFAULT: '#2f8f83', 900: '#14433d', 800: '#1b5a52', 700: '#227166', 600: '#2f8f83', 500: '#3fa89a', 400: '#6cc2b6', 200: '#bfe5df', 100: '#e2f3f0', 50: '#f1faf8' },
        brand: { red: '#d9463b', redsoft: '#fdecea', gold: '#e0a526', goldsoft: '#fdf4de' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,20,18,.04), 0 1px 1px rgba(17,20,18,.03)',
        pop: '0 12px 32px -8px rgba(17,20,18,.25)',
      },
    },
  },
  plugins: [],
} satisfies Config;
