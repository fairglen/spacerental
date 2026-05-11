import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3D7A5E',
          light: '#A8D5BA',
          foreground: '#FFFFFF',
        },
        accent: {
          DEFAULT: '#E8F4F0',
          foreground: '#3D7A5E',
        },
        background: '#F9FAFB',
        foreground: '#1A1A2E',
        muted: {
          DEFAULT: '#6B7280',
          foreground: '#6B7280',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#1A1A2E',
        },
        border: '#E5E7EB',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
