import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Orders",
    template: "%s · Draep admin",
  },
  description:
    "Track and manage every customer blouse order — fulfilment status, payments, and creating new orders.",
};

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
