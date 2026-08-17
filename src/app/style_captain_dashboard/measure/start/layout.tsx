import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "New measurement",
  description:
    "Start a walk-in measurement job — pick the garment and create the job before capturing measurements.",
};

export default function SCMeasureStartLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
