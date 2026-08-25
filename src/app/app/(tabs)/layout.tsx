import { AppTabs } from "@/components/app/AppTabs";

/**
 * Shared shell for the three customer tabs (explore / create / profile).
 *
 * AppTabs renders every pane itself — above the routed pages — so a pane,
 * once visited, stays mounted (hidden) across tab switches and in-progress
 * work survives. The pages under this layout are therefore intentional
 * no-op shells that only give each tab a real, deeplinkable URL.
 */
export default function TabsLayout() {
  return <AppTabs />;
}
