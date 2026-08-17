import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Users",
    template: "%s · Draep admin",
  },
  description:
    "All Draep accounts — customers, admins, Style Captains and tailors — plus acquisition tracking.",
};

export default function UsersLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
