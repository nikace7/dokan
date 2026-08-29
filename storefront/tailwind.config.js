/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['Georgia', "'Times New Roman'", 'Times', 'serif'],
        sans: [
          'system-ui',
          '-apple-system',
          "'Segoe UI'",
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
