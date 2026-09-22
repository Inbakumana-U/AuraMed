import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backwards compatibility with existing styles
        obsidian: "#080c14",

        // Vadim (Sollas Design) FinTech Dark Tokens (Zero purple)
        fintech: {
          bg: "#080C14",
          card: "#0F1623",
          cardHover: "#152033",
          border: "#1E2A40",
          neonMint: "#00F59B",
          neonCyan: "#00D8F6",
          slateText: "#94A3B8",
        },

        // Asiq M. (Netro Systems) KwikQuiz Gamified Light Tokens
        kwik: {
          bg: "#F8FAFC",
          card: "#FFFFFF",
          emerald: "#10B981",
          emeraldDark: "#059669",
          amber: "#F59E0B",
          coral: "#F43F5E",
          pillBg: "#ECFDF5",
        },
      },
      boxShadow: {
        "kwik-card": "0 10px 25px -5px rgba(16, 185, 129, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.02)",
        "fintech-card": "0 12px 32px -4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)",
        "fintech-glow": "0 0 20px -3px rgba(0, 245, 155, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;