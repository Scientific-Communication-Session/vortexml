/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Mirrors src/styles/tokens.css (Violet Night). Hex here so Tailwind's
      // opacity modifiers (bg-accent/20) work; the CSS tokens are the source.
      fontFamily: {
        sans: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter: '-0.03em',
      },
      colors: {
        bg: {
          primary: '#08080b',
          secondary: '#0e0e13',
          card: '#13131a',
          glass: '#1b1b23',
          input: '#1b1b23',
        },
        accent: {
          DEFAULT: '#8c86fc',
          fill: '#6a5dde',
          text: '#b7b9ff',
          1: '#8c86fc',
          2: '#8c86fc',
          3: '#b7b9ff',
          4: '#a5bdf2',
          5: '#90a6f7',
        },
        text: {
          primary: '#f5f5f8',
          secondary: '#afb0be',
          muted: '#848593',
          accent: '#b7b9ff',
        },
      },
      transitionTimingFunction: {
        'glide': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'emphasized': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      keyframes: {
        'shimmer-slow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '0.9' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -8px, 0)' },
        },
      },
      animation: {
        'shimmer-slow': 'shimmer-slow 6s ease-in-out infinite',
        'float-slow': 'float-slow 7s ease-in-out infinite',
      },
    },
  },
  corePlugins: {
    preflight: false,
  },
  plugins: [],
}
