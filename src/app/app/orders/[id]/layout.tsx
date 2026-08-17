import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Order details",
  description:
    "The full breakdown of your order — every selection and add-on, the price summary, payments and invoice download.",
};

export default function AccountOrderDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
