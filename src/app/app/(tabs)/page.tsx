import { redirect } from "next/navigation";

/** Bare /app is the explore tab's canonical home. */
export default function AppIndexPage() {
  redirect("/app/explore");
}
