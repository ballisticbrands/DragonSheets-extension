/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{ts,tsx}",
    "./settings.html",
    "./mock-oauth.html",
  ],
  theme: {
    extend: {
      colors: {
        // BRANDING.md palette
        forest: "#2F7D4F",
        "forest-dark": "#256B42",
        lime: "#98CC65",
        deep: "#0F3D2E",
        ink: "#1A1A1A",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "Roboto",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
