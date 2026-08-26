import type { Metadata } from "next";
import { LeadsHeatmap } from "@/components/leads/LeadsHeatmap";

export const metadata: Metadata = {
  title: "Leads Map",
};

export default function LeadsMapPage() {
  return <LeadsHeatmap />;
}
