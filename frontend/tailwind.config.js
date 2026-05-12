/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Cabinet Grotesk"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Times New Roman', 'Georgia', 'serif'],
        serif: ['"Cormorant Garamond"', 'Times New Roman', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter: '-0.03em',
      },
      colors: {
        bg: {
          primary: '#06060f',
          secondary: '#0c0c1e',
          card: '#0e0e24',
          glass: '#141432',
          input: '#19193c',
        },
        accent: {
          1: '#6366f1',
          2: '#8b5cf6',
          3: '#a855f7',
          4: '#06b6d4',
          5: '#3b82f6',
        },
        text: {
          primary: '#f0f0ff',
          secondary: '#9d9dba',
          muted: '#5a5a7a',
          accent: '#8b5cf6',
        }
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
