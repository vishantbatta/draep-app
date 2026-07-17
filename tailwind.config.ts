import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens — extend ONLY from CSS vars so ad-hoc hex values can't leak in.
        // Source of truth: src/styles/tokens.css (mirrors Brand Book §4 / spec §3.1)
        "ink-navy": "var(--ink-navy)",
        "draep-orange": "var(--draep-orange)",
        ember: "var(--ember)",
        "tape-silver": "var(--tape-silver)",
        "chalk-white": "var(--chalk-white)",
        "navy-interactive": "var(--navy-interactive)",
        "navy-disabled": "var(--navy-disabled)",
        "navy-bg": "var(--navy-bg)",
        "orange-highlight": "var(--orange-highlight)",
        "orange-fill": "var(--orange-fill)",
        "warm-bg": "var(--warm-bg)",
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        info: "var(--info)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        heading: ["var(--font-poppins)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Mobile-first scale from Brand Book §5 / spec §3.2
        display: ["32px", { lineHeight: "38px" }],
        h1: ["24px", { lineHeight: "30px" }],
        h2: ["20px", { lineHeight: "26px" }],
        h3: ["17px", { lineHeight: "24px" }],
        body: ["15px", { lineHeight: "22px" }],
        caption: ["13px", { lineHeight: "18px" }],
        data: ["14px", { lineHeight: "20px" }],
      },
      borderRadius: {
        card: "12px",
        pill: "9999px",
      },
      boxShadow: {
        // Single elevation level — navy at 8% opacity, soft and warm (Brand Book §8).
        brand: "0 6px 20px -8px rgba(8, 48, 104, 0.18), 0 2px 6px -2px rgba(8, 48, 104, 0.08)",
      },
      backgroundImage: {
        // Tape Gradient — 135°, top-left to bottom-right (Brand Book §4).
        tape:
          "linear-gradient(135deg, #F89010 0%, #E87810 33%, #D06010 66%, #A85010 100%)",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        rivetPulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.18)", opacity: "0.75" },
        },
        curlIn: {
          "0%": { opacity: "0", transform: "rotate(-2deg) translateY(4px)" },
          "100%": { opacity: "1", transform: "rotate(0) translateY(0)" },
        },
      },
      animation: {
        rivet: "rivetPulse 2s ease-in-out infinite",
        "curl-in": "curlIn 500ms ease-in-out both",
      },
      maxWidth: {
        column: "480px",
      },
    },
  },
  plugins: [],
};

export default config;
