/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#2F3E2E',
          hover:   '#253320',
          muted:   'rgba(47,62,46,0.55)',
          faint:   'rgba(47,62,46,0.08)',
        },
        paper: {
          DEFAULT: '#F1EDE6',
          dark:    '#E8E2D9',
          card:    '#FAFAF8',
        },
        accent: {
          DEFAULT: '#9F4E5A',
          hover:   '#8C3D49',
          light:   'rgba(159,78,90,0.12)',
        },
        danger: {
          DEFAULT: '#C0392B',
          bg:      'rgba(192,57,43,0.10)',
          text:    '#B03A2E',
        },
        warn: {
          DEFAULT: '#A0522D',
          bg:      'rgba(160,82,45,0.12)',
          text:    '#8B4513',
        },
        ok: {
          DEFAULT: '#4A7C59',
          bg:      'rgba(74,124,89,0.12)',
          text:    '#3A6347',
        },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', '"Source Han Serif CN"', 'Georgia', 'serif'],
        sans:  ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '12px',
      },
      boxShadow: {
        card: '0 8px 24px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};
