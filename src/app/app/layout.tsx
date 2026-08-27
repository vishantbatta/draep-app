import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ProfileCompletionGate } from "@/components/auth/ProfileCompletionGate";

export const metadata: Metadata = {
  title: {
    default: "Your account",
    template: "%s · draep",
  },
  description:
    "Your Draep account — orders with live status, invoices, active drafts and one-tap re-order from your design library.",
};

export default function AccountDashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* Blocking profile step — a signed-in user missing name/gender can't
          use any /app surface until they fill it. */}
      <ProfileCompletionGate />
    </>
  );
}
