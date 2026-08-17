import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/AdminShell";

// Server layout so the admin section can export metadata (the interactive
// shell — auth gate, nav rail, drawer — lives in AdminShell, a client
// component that receives the server-rendered children as props).
export const metadata: Metadata = {
  title: {
    default: "Admin",
    template: "%s · Draep admin",
  },
  description:
    "Draep admin dashboard — manage orders, users, the garment catalogue, measurement schemas, scheduling and platform data.",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
