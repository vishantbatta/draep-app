import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Admin login",
  description:
    "Sign in to the Draep admin dashboard to manage orders, users, the catalogue and scheduling.",
};

export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
