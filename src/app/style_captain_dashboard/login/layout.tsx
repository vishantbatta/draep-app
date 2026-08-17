import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Login",
  description:
    "Sign in with your phone and password to see your measurement jobs and schedule.",
};

export default function SCLoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
