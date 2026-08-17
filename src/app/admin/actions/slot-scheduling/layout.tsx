import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Slot scheduling",
  description:
    "Configure visit slot durations, buffers, working hours and booking windows.",
};

export default function SlotSchedulingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
