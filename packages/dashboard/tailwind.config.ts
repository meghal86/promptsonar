import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ── Repository Explorer v2 palette ──────────────────────────────
        // Namespaced so it never clobbers the shadcn tokens above.
        // NOTE: the spec's `muted` (#6f6a63) is exposed as `ink-muted`
        // because shadcn already owns `muted`. Everything else matches spec.
        ink: "#1c1917",
        "ink-muted": "#6f6a63",
        faint: "#9a948c",
        amber: {
          DEFAULT: "#b07d09",
          soft: "rgba(244,221,150,0.5)",
          line: "rgba(214,170,70,0.55)",
          badge: "rgba(251,224,160,0.55)",
          "badge-line": "rgba(214,160,60,0.55)",
        },
        crit: "#b91c1c",
        danger: {
          DEFAULT: "#c81e1e",
          500: "#ef4444",
          soft: "rgba(254,226,222,0.7)",
          line: "rgba(238,150,140,0.7)",
        },
        high: "#c2410c",
        med: "#b45309",
        safe: {
          DEFAULT: "#057a52",
          soft: "rgba(209,242,226,0.65)",
          line: "rgba(120,200,160,0.6)",
        },
        blue: {
          DEFAULT: "#3b6ea5",
          soft: "rgba(214,229,245,0.6)",
          line: "rgba(150,185,225,0.6)",
        },
        neu: {
          DEFAULT: "#475569",
          soft: "rgba(236,239,244,0.85)",
          line: "rgba(196,203,214,0.7)",
        },
        hairline: "rgba(140,130,115,0.18)",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        playfair: ["Playfair Display", "Georgia", "serif"],
        // Repository Explorer v2 uses `font-display` for the Playfair accents.
        display: ['"Playfair Display"', "Georgia", "serif"],
        sans: ["Geist", "Inter", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', '"IBM Plex Mono"', "monospace"],
      },
      backdropBlur: {
        glass: "20px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
