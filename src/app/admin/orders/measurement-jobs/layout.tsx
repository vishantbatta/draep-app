import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Measurement jobs",
    template: "%s · Draep admin",
  },
  description:
    "Home-visit measurement jobs — assignment to Style Captains, visit status and scheduling.",
};

export default function MeasurementJobsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
