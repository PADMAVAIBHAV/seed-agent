import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          cyan: "#2EE6FF",
          pink: "#FF2EC4",
          lime: "#8BFF5D",
          slate: "#0A0F1F",
          panel: "rgba(10, 15, 31, 0.65)",
        },
      },
      boxShadow: {
        glow: "0 0 20px rgba(46, 230, 255, 0.35)",
        pink: "0 0 20px rgba(255, 46, 196, 0.25)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(46,230,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(46,230,255,0.12) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
