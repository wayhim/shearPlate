/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'SF Pro Text', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'Menlo', 'monospace']
      },
      fontSize: {
        '2xs': '11px',
        xs: '12px',
        base: '13px',
        md: '14px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '28px',
        '4xl': '34px'
      },
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          active: 'var(--color-primary-active)',
          subtle: 'var(--color-primary-subtle)',
          'on': 'var(--color-on-primary)'
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
          'on': 'var(--color-on-accent)'
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          hover: 'var(--color-surface-hover)',
          active: 'var(--color-surface-active)'
        },
        semantic: {
          success: 'var(--color-success)',
          warning: 'var(--color-warning)',
          error: 'var(--color-error)',
          info: 'var(--color-info)'
        }
      },
      spacing: {
        '1': '2px', '2': '4px', '3': '6px', '4': '8px', '5': '10px',
        '6': '12px', '8': '16px', '10': '20px', '12': '24px',
        '16': '32px', '20': '40px', '24': '48px', '32': '64px'
      },
      borderRadius: {
        xs: '4px', sm: '6px', md: '8px', lg: '12px',
        xl: '16px', '2xl': '20px', full: '9999px'
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        popover: 'var(--shadow-popover)',
        window: 'var(--shadow-window)'
      },
      transitionDuration: {
        fast: '100ms',
        normal: '180ms',
        slow: '280ms',
        modal: '360ms'
      }
    }
  },
  plugins: []
}
