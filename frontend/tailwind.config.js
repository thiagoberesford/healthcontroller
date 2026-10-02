/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e1116",
        card: "#171c24",
        card2: "#1e242f",
        border: "#2a3140",
        ink: "#e7ecf3",
        muted: "#8b97a8",
        teal: "#00b4b3",
        blue: "#3b82f6",
        orange: "#ff5d1f",
        green: "#4ade80",
        purple: "#a78bfa",
        red: "#f87171",
      },
    },
  },
  plugins: [],
};
