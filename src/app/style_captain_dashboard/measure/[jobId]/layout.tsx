import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Measurement job",
  description:
    "Capture and save customer body measurements, materials and notes, then complete the job.",
};

export default function SCMeasureJobLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
