import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Promotions",
  description:
    "Coupons and sales — percent, flat or price-override discounts scoped to orders, garments, components or add-ons.",
};

export default function PromotionsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
