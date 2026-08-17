import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Measurements",
  description:
    "Measurement schema — metrics, priority order and links to garments and style components.",
};

export default function MeasurementsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
