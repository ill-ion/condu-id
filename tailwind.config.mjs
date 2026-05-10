/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      // Editorial / academic — warm off-white paper, deep ink, a single
      // restrained accent for "verified" green and one for "skipped"
      // amber. No bright primary blue, no purple gradients.
      colors: {
        paper: {
          DEFAULT: "#faf8f3",
          dark: "#f3efe7",
        },
        ink: {
          DEFAULT: "#1a1a1a",
          soft: "#3a3a3a",
          muted: "#6b6b6b",
          faint: "#a09e98",
        },
        rule: "#d8d3c8",
        accent: {
          // Verified — eucalyptus, not bright green. Reads as "okay".
          DEFAULT: "#3d6e5a",
          soft: "#e7eee9",
        },
        warn: {
          DEFAULT: "#8a6d2f",
          soft: "#f3eddb",
        },
        fail: {
          DEFAULT: "#8e3a3a",
          soft: "#f4e5e5",
        },
      },
      fontFamily: {
        serif: [
          "Charter",
          "Iowan Old Style",
          "Source Serif Pro",
          "Georgia",
          "serif",
        ],
        sans: [
          "Inter",
          "Söhne",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      maxWidth: {
        prose: "68ch",
        page: "1100px",
      },
    },
  },
  plugins: [],
};
