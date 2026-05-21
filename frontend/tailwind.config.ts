import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        carnation: {
          DEFAULT: '#DC143C',
          dark: '#8B0000',
          light: '#FF6B6B',
        },
        surface: {
          DEFAULT: '#0A0A0A',
          secondary: '#141414',
          card: '#1A1A1A',
        },
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [{
      carnation: {
        primary: '#DC143C',
        secondary: '#8B0000',
        accent: '#FF6B6B',
        neutral: '#1A1A1A',
        'base-100': '#0A0A0A',
        'base-200': '#141414',
        'base-300': '#1A1A1A',
        info: '#3ABFF8',
        success: '#36D399',
        warning: '#FBBD23',
        error: '#F87272',
      },
    }],
  },
};
export default config;
