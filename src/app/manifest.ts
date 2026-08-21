import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Draep — Stitch Your Wish",
    short_name: "draep",
    description:
      "Design your custom blouse on the phone. A Style Captain visits your home to measure, then delivers and trials — fixes included.",
    // `start_url` is required for Chrome to consider the app installable at
    // all — without it beforeinstallprompt never fires (verified against a
    // known-installable control site). "/" launches every install at the
    // persona picker home; iOS Safari ignores start_url and launches the
    // exact page that was added to the home screen either way.
    start_url: "/",
    // `scope: "/"` must stay so navigation stays inside the app window.
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FDFBF7",
    theme_color: "#083068",
    categories: ["shopping", "lifestyle"],
    // Chrome only fires beforeinstallprompt (→ install popup) when the manifest
    // has a SQUARE PNG icon ≥144px with purpose "any". logo_alpha_icon.png is
    // 560x606 (non-square), so these are square renders of it: transparent
    // padding for "any", ink-navy fill for "maskable" (launcher crop safe zone).
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
