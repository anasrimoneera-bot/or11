/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: '#1f2937',
        sidebarHover: '#374151',
        accent: '#f97316',
      },
    },
  },
  plugins: [],
};
