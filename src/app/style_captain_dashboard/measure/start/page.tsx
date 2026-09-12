import { redirect } from "next/navigation";

/**
 * v1 walk-in start form — replaced by the staged walk-in wizard
 * (WALKIN_V2_PLAN.md §5.1). The route stays as a redirect so bookmarks and
 * the dashboard CTA land on the new flow.
 */
export default function MeasureStartPage() {
  redirect("/style_captain_dashboard/walk-in");
}
