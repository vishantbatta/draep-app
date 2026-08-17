import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Data",
  description:
    "Raw table browser — query any platform table with filters, sorting and pagination.",
};

export default function DataLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
