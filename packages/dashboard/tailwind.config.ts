import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0F4C81',
          50: '#e8f0f9',
          900: '#082d4d',
        },
        teal: { DEFAULT: '#00B8A9' },
        amber: { DEFAULT: '#F6A623' },
        coral: { DEFAULT: '#E84855' },
        emerald: { DEFAULT: '#2ECC71' },
      },
    },
  },
  plugins: [],
} satisfies Config;
