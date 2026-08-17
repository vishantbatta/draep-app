import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Order details",
  description:
    "Full breakdown of a single order — garment selections, add-ons, pricing, payment ledger and status.",
};

export default function OrderDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
