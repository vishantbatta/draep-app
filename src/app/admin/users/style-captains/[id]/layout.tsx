import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Style Captain details",
  description:
    "A Style Captain's profile, assigned measurement jobs and weekly schedule.",
};

export default function StyleCaptainDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
