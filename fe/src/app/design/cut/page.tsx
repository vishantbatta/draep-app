"use client";

import { DesignScreenShell } from "@/components/layout/DesignScreenShell";
import { OptionCardGrid } from "@/components/selectors/OptionCardGrid";
import { findCategory } from "@/lib/catalog";
import { useCategory } from "@/lib/use-category";

const ROUTE = "/design/cut";
const CATEGORY = findCategory(ROUTE)!;

export default function CutPage() {
  const { draft, selection, setSelection } = useCategory(CATEGORY.id);

  if (!draft) return null;

  return (
    <DesignScreenShell
      draft={draft}
      route={ROUTE}
      title={CATEGORY.label}
      activeLayerPrefix="blouse_cut:"
    >
      <OptionCardGrid category={CATEGORY} selection={selection} onSelect={setSelection} />
    </DesignScreenShell>
  );
}
