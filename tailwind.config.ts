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
          // A leaf laid on the desk: the surface a panel sits on, one step lighter
          // than the page so a card reads as an object rather than an outline. The
          // hue is the same paper, only nearer the light.
          raised: '#F8FAF5',
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
      /**
       * A named scale, because the app was previously written almost entirely at 11
       * and 12px — which flattened the hierarchy until a section heading, a field
       * label and a safety violation all read at the same weight. Each name says what
       * the size is *for*, so the choice is a decision about role rather than about
       * pixels.
       */
      fontSize: {
        micro: ['0.75rem', { lineHeight: '1.1rem' }],
        label: ['0.8125rem', { lineHeight: '1.15rem' }],
        data: ['0.8125rem', { lineHeight: '1.3rem' }],
        body: ['0.9375rem', { lineHeight: '1.65' }],
        lede: ['1.125rem', { lineHeight: '1.6' }],
      },
      boxShadow: {
        // Paper on paper, not a floating panel. Barely there by design.
        card: '0 1px 0 0 rgb(30 35 33 / 0.04), 0 1px 3px 0 rgb(30 35 33 / 0.05)',
      },
      maxWidth: {
        // A measure prose can actually be read at — roughly 68 characters at 15px.
        prose: '34rem',
      },
    },
  },
  plugins: [],
}

export default config
