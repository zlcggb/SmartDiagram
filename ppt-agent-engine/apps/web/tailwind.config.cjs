/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#FFFFFF",
        primary: "#0066CC",
        title: "#003F7D",
        body: "#25313C",
        muted: "#667085",
        card: "#F7FAFC",
        line: "#D9E2EC",
        tint: "#EAF4FF",
        accent: "#00A6D6",
        success: "#12B76A",
        risk: "#D92D20",
        pending: "#F79009"
      },
      boxShadow: {
        soft: "0 8px 24px rgba(0, 63, 125, 0.08)"
      }
    }
  },
  plugins: []
};
