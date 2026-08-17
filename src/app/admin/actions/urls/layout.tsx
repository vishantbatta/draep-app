import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Short links",
  description:
    "Create and manage short links that send customers straight into the booking flow.",
};

export default function ShortLinksLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
