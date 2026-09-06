import { redirect } from "next/navigation";

/** Promo settings now live on the Promotions page itself (Settings view). */
export default function PromoConfigPage() {
  redirect("/admin/actions/promotions");
}
