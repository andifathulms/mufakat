import type { Config } from 'tailwindcss'

/**
 * Semantic tokens only. See PRD §10.
 * `vermilion` is reserved exclusively for safety violations.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './data/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        stock: {
          DEFAULT: '#E9EDE4',
          deep: '#DCE2D5',
          pale: '#F2F5EE',
        },
        ink: {
          DEFAULT: '#1E2321',
          soft: '#4A524D',
          // 5.08:1 on stock, 5.47:1 on stock-pale, 4.56:1 on stock-deep. This is the
          // most-used secondary text colour in the app, so it clears AA for normal
          // text on every surface it is set on, not just the lightest one.
          faint: '#5C6560',
          // Purely decorative ruling: the ledger grid, section separators. The grid's
          // meaning is carried by cell content, table headers and alignment, not by
          // the line weight, so this stays light enough to read as a ruled page.
          rule: '#C3CBBE',
          // Borders of interactive components — buttons, inputs, selects — which need
          // 3:1 against their background under WCAG 1.4.11. 3.60:1 on stock.
          edge: '#727E6B',
        },
        follower: '#6B7770',
        candidate: '#B8862F',
        leader: '#2C5578',
        committed: '#3E6B4A',
        vermilion: '#B03A2E',
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },
    },
  },
  plugins: [],
}

export default config
