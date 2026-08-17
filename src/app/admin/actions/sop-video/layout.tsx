import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "SOP video",
  description:
    "Generate and monitor the measurement SOP videos shown to Style Captains.",
};

export default function SopVideoLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
