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
          faint: '#8C948E',
          rule: '#C3CBBE',
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
