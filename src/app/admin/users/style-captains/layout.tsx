import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Style Captains",
    template: "%s · Draep admin",
  },
  description:
    "The Style Captain roster — profiles, assigned measurement jobs and schedules.",
};

export default function StyleCaptainsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
