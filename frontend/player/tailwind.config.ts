import type { Config } from 'tailwindcss';
import { colors, defaultBorderColor } from './tailwind.tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    colors,
    borderColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: defaultBorderColor }),
    divideColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: defaultBorderColor }),
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
