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
        "deep-ember": "var(--deep-ember)",
        "tape-silver": "var(--tape-silver)",
        "chalk-white": "var(--chalk-white)",

        // ACCESSIBLE ORANGE — use this for any orange that is text, an icon,
        // or a button fill under white text. draep-orange fails WCAG AA; deep-ember
        // is the brand-book "deep ember" stop and passes at 5.5:1 on white.
        "accent-text": "var(--accent-text)",
        "accent-fill": "var(--accent-fill)",

        // Brand Book §4/§5 — text colors
        ink: "var(--ink)",
        muted: "var(--muted)",

        // Brand Book §4 — surface tints
        "warm-sand": "var(--warm-sand)",
        "mist-navy": "var(--mist-navy)",

        // Brand Book §4 — hairline borders
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",

        // Legacy aliases — keep so existing utility classes continue to work.
        "navy-interactive": "var(--navy-interactive)",
        "navy-disabled": "var(--navy-disabled)",
        "navy-bg": "var(--navy-bg)",
        "orange-highlight": "var(--orange-highlight)",
        "orange-fill": "var(--orange-fill)",
        "warm-bg": "var(--warm-bg)",

        // Semantic — Brand Book §4
        success: "var(--success)",
        "success-text": "var(--success-text)", // AA on success-bg
        "success-bg": "var(--success-bg)",
        "success-border": "var(--success-border)",
        warning: "var(--warning)",
        error: "var(--error)",
        "error-text": "var(--error-text)", // AA on error-bg
        "error-bg": "var(--error-bg)",
        "error-border": "var(--error-border)",
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
        // Brand Book §5/§6 — eyebrow label (mono, tracked, uppercase)
        eyebrow: ["12px", { lineHeight: "16px", letterSpacing: "0.18em" }],
      },
      borderRadius: {
        card: "12px",
        sheet: "16px",
        pill: "9999px",
      },
      boxShadow: {
        // Brand Book §8 — three-tier warm elevation
        card: "var(--shadow-card)", // card surfaces
        brand: "var(--shadow-brand)", // floating surfaces (sticky bars, sheets)
        primary: "var(--shadow-primary)", // primary CTA ember glow
      },
      backgroundImage: {
        // Tape Gradient — 135°, top-left to bottom-right (Brand Book §4).
        tape: "linear-gradient(135deg, #F89010 0%, #E87810 40%, #D06010 75%, #A85010 100%)",
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
