import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0F4C81', dark: '#0a3d6b', light: '#1a5fa3' },
        teal: { DEFAULT: '#00B8A9', dark: '#00958a', light: '#00d4c4' },
        amber: { DEFAULT: '#F6A623', dark: '#e09410', light: '#f8bc55' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
