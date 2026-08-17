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
    icons: [
      {
        src: "/logo_alpha_icon.png",
        sizes: "560x606",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo_alpha_icon.png",
        sizes: "560x606",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
