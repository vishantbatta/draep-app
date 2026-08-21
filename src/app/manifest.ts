import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Draep — Stitch Your Wish",
    short_name: "draep",
    description:
      "Design your custom blouse on the phone. A Style Captain visits your home to measure, then delivers and trials — fixes included.",
    // No `start_url`: on install, iOS Safari and Android Chrome stamp the page
    // the user was on (e.g. /admin) as the app's launch URL. Adding start_url
    // back would force every install to open that URL instead.
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
