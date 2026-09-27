/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/pages/**/*.{js,ts,jsx,tsx}", "./src/components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f5ff",
          100: "#e6ecff",
          500: "#4f5df7",
          600: "#3d49e0",
          700: "#2f39b0",
        },
      },
    },
  },
  plugins: [],
};
