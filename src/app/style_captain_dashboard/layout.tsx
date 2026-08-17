import type { Metadata } from "next";
import type { ReactNode } from "react";

import { StyleCaptainShell } from "@/components/style-captain/StyleCaptainShell";

// Server layout so the Style Captain section can export metadata (the
// interactive shell — auth gate + mweb header — is StyleCaptainShell, a
// client component that receives the server-rendered children as props).
export const metadata: Metadata = {
  title: {
    default: "Style Captain",
    template: "%s · Draep Style Captain",
  },
  description:
    "Style Captain dashboard — view assigned measurement jobs, today's schedule, and capture customer measurements on the go.",
};

export default function StyleCaptainLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <StyleCaptainShell>{children}</StyleCaptainShell>;
}
