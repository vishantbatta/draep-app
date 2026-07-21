"use client";

import { DesignScreenShell } from "@/components/layout/DesignScreenShell";
import { OptionCardGrid } from "@/components/selectors/OptionCardGrid";
import { ContextualAddOns } from "@/components/selectors/ContextualAddOns";
import { findCategory } from "@/lib/catalog";
import { useCategory } from "@/lib/use-category";

const ROUTE = "/design/length";
const CATEGORY = findCategory(ROUTE)!;

export default function LengthPage() {
  const { draft, selection, setSelection } = useCategory(CATEGORY.id);

  if (!draft) return null;

  return (
    <DesignScreenShell
      draft={draft}
      route={ROUTE}
      title={CATEGORY.label}
      activeLayerPrefix="blouse_length:"
    >
      <OptionCardGrid category={CATEGORY} selection={selection} onSelect={setSelection} />
      <ContextualAddOns route={ROUTE} />
    </DesignScreenShell>
  );
}
