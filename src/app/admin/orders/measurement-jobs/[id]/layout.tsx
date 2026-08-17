import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Measurement job",
  description:
    "Details of one measurement job — customer, assigned Style Captain, visit slot and completion state.",
};

export default function MeasurementJobDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
