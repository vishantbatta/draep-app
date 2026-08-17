import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Validation rules",
  description:
    "Rules that validate customer measurement inputs against safe per-garment ranges.",
};

export default function ValidationRulesLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
