import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B1220",
          900: "#111827",
          700: "#374151",
          600: "#4B5563",
          500: "#6B7280",
          400: "#9CA3AF"
        },
        mint: {
          900: "#075E54",
          800: "#0A6C61",
          700: "#128C7E",
          600: "#18A08F",
          500: "#25D366",
          100: "#DCF8C6",
          50: "#ECFDF5"
        },
        surface: {
          50: "#F6F8FA",
          100: "#EEF3F5",
          200: "#E5E7EB"
        },
        signal: {
          amber: "#D78B12",
          red: "#D94F45",
          blue: "#3278B9"
        }
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.05), 0 18px 45px rgba(15, 23, 42, 0.07)",
        soft: "0 16px 40px rgba(15, 23, 42, 0.08)",
        glow: "0 14px 34px rgba(18, 140, 126, 0.18)"
      }
    }
  },
  plugins: []
} satisfies Config;
