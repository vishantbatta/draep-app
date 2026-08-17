import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Catalogue",
    template: "%s · Draep admin",
  },
  description:
    "The garment catalogue — garments, style components, variations, variation types and add-ons.",
};

export default function CatalogueLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
