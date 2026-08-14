import { redirect } from "next/navigation";

// The dashboard root lands on Orders by default; the raw table browser
// lives at /admin/data.
export default function AdminRootPage() {
  redirect("/admin/orders");
}
