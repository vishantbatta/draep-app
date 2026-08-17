import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Calendar",
  description:
    "Slot calendar of scheduled measurement visits across Style Captains.",
};

export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
