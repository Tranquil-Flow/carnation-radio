import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  daisyui: {
    themes: [
      {
        carnationradio: {
          "primary": "#FF0000",    // Red color for primary elements
          "secondary": "#FFFFFF",  // White for secondary elements
          "accent": "#FF0000",     // Red for accent, matching primary
          "neutral": "#1A1A1A",    // Dark gray for neutral elements
          "base-100": "#000000",   // Black for the background
          "info": "#FFFFFF",       // White for informational elements
          "success": "#00FF00",    // Green for success messages
          "warning": "#FFA500",    // Orange for warnings
          "error": "#FF0000",      // Red for errors, matching primary
        },
      },
    ],
  },
  plugins: [require("daisyui")],
};

export default config;