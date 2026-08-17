import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Style library",
  description:
    "The design library — style reference images and garments surfaced to customers while designing.",
};

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
