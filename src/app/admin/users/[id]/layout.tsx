import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "User details",
  description:
    "Profile, roles and login links for a single Draep user.",
};

export default function UserDetailLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
