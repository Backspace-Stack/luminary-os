/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Base surfaces
        'lum-bg':       '#08090F',
        'lum-surface':  '#0E1117',
        'lum-elevated': '#141A24',
        'lum-border':   'rgba(255,255,255,0.06)',

        // Accent palette
        'lum-violet':   '#7C6DFF',
        'lum-violet-dim': 'rgba(124,109,255,0.15)',
        'lum-cyan':     '#22D3EE',
        'lum-cyan-dim': 'rgba(34,211,238,0.15)',
        'lum-purple':   '#B45AFF',

        // Semantic
        'lum-success':  '#10B981',
        'lum-warning':  '#F59E0B',
        'lum-error':    '#EF4444',

        // Text
        'lum-text':         '#E5EAF0',
        'lum-text-secondary': '#8892A4',
        'lum-text-muted':   '#4A5568',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      animation: {
        pulse: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
