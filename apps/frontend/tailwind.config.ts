import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        'surface-2': 'var(--c-surface-2)',
        'surface-3': 'var(--c-surface-3)',
        border: 'var(--c-border)',
        line: 'var(--c-border-2)',
        fg: 'var(--c-fg)',
        'fg-muted': 'var(--c-fg-muted)',
        'fg-faint': 'var(--c-fg-faint)',
        primary: 'var(--c-primary)',
        'primary-soft': 'var(--c-primary-soft)',
        accent: 'var(--c-accent)',
        warn: 'var(--c-warn)',
        danger: 'var(--c-danger)',
        info: 'var(--c-info)',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      fontSize: {
        xxs: ['11px', '16px'],
        xs: ['12px', '18px'],
        sm: ['13px', '20px'],
        base: ['14px', '22px'],
        lg: ['16px', '24px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
        '3xl': ['30px', '38px'],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        '1': '0 1px 2px rgba(0,0,0,0.25)',
        '2': 'var(--shadow-card)',
        '3': '0 8px 24px rgba(0,0,0,0.45)',
        pop: '0 8px 32px rgba(0,0,0,0.55)',
      },
      zIndex: {
        toast: '80',
        modal: '90',
        pop: '70',
      },
      transitionTimingFunction: {
        app: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        app: '150ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(2px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms cubic-bezier(0.4,0,0.2,1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.4,0,0.2,1)',
        'scale-in': 'scale-in 150ms cubic-bezier(0.4,0,0.2,1)',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
