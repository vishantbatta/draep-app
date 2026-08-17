import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Draep — Stitch Your Wish",
    short_name: "draep",
    description:
      "Design your custom blouse on the phone. A Style Captain visits your home to measure, then delivers and trials — fixes included.",
    start_url: "/",
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
