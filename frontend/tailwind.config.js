/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#4F46E5',
        accent: '#10B981',
        danger: '#EF4444',
        warning: '#F59E0B',
      }
    }
  },
  plugins: [],
}
