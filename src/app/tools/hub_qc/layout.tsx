import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hub QC Tool — Draep",
};

export default function HubQcToolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
