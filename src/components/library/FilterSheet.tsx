"use client";

/**
 * FilterSheet — the "All filters" bottom sheet for the library browse page.
 *
 * Sections:
 *   • Occasion        — chips derived from published designs (facets)
 *   • Body type       — chips from ideal_body_types
 *   • Celebrity       — chips from celebrity_name
 *   • Style catalogue — per-component accordions: variation chips, each with
 *                       nested variation-TYPE chips where they exist
 *   • Add-ons         — one accordion: per-addon chip + nested variation chips
 *
 * Draft-then-apply: tapping chips mutates a local draft seeded from the
 * active filters when the sheet opens; Apply commits via onApply. Closing
 * without Apply discards.
 *
 * Two modes:
 *   • Full sheet (no `singleSection`) — every section, opened by the
 *     "All filters" button on the browse page.
 *   • Quick sheet (`singleSection`) — ONLY that facet's chip cloud, opened
 *     by the matching upfront pill (Occasion / Body type / Celebrity).
 *     Reset in this mode clears just that group.
 */

import { useEffect, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { ChevronDown, Sparkle } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import type {
  FacetCountOut,
  LibraryFacetsOut,
  PickerComponentOut,
} from "@/types/api";

/* ============================================================ */

/** Active browse filters — mirrors GET /library's array params. */
export interface LibraryFilters {
  occasion: string[];
  body_type: string[];
  celebrity: string[];
  variation: string[];
  variation_type: string[];
  addon: string[];
  addon_variation: string[];
}

export const EMPTY_FILTERS: LibraryFilters = {
  occasion: [],
  body_type: [],
  celebrity: [],
  variation: [],
  variation_type: [],
  addon: [],
  addon_variation: [],
};

/** The three upfront-pill sections — each opens its own quick sheet. */
export type QuickFilterSection = "occasion" | "body_type" | "celebrity";

const QUICK_GROUP: Record<QuickFilterSection, keyof LibraryFilters> = {
  occasion: "occasion",
  body_type: "body_type",
  celebrity: "celebrity",
};

/** Total number of individual selections across all groups. */
export function countFilters(f: LibraryFilters): number {
  return (
    f.occasion.length +
    f.body_type.length +
    f.celebrity.length +
    f.variation.length +
    f.variation_type.length +
    f.addon.length +
    f.addon_variation.length
  );
}

export function isEmptyFilters(f: LibraryFilters): boolean {
  return countFilters(f) === 0;
}

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  facets: LibraryFacetsOut | null;
  filters: LibraryFilters;
  /** Quick mode: render ONLY this facet's chips (upfront pills use this). */
  singleSection?: QuickFilterSection | null;
  onApply: (filters: LibraryFilters) => void;
}

/* ============================================================ */

export function FilterSheet({
  open,
  onClose,
  facets,
  filters,
  singleSection,
  onApply,
}: FilterSheetProps) {
  const [draft, setDraft] = useState<LibraryFilters>(filters);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  /* Seed the draft from the live filters each time the sheet opens. */
  useEffect(() => {
    if (open) {
      setDraft(filters);
      setExpanded({});
    }
  }, [open, filters]);

  const toggle = (key: keyof LibraryFilters, value: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value)
        ? d[key].filter((v) => v !== value)
        : [...d[key], value],
    }));

  const selCount = countFilters(draft);
  const quickCount = singleSection
    ? draft[QUICK_GROUP[singleSection]].length
    : 0;

  const sheetTitle = singleSection
    ? singleSection === "occasion"
      ? strings.libraryFilters.occasionSection
      : singleSection === "body_type"
        ? strings.libraryFilters.bodyTypeSection
        : strings.libraryFilters.celebritySection
    : strings.libraryFilters.sheetTitle;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={sheetTitle}
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-2.5">
          <button
            type="button"
            onClick={() =>
              setDraft(
                singleSection
                  ? { ...draft, [QUICK_GROUP[singleSection]]: [] }
                  : EMPTY_FILTERS,
              )
            }
            disabled={singleSection ? quickCount === 0 : selCount === 0}
            className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-semibold text-ink-navy transition-all hover:border-navy-interactive active:scale-[0.98] disabled:opacity-40"
          >
            {strings.libraryFilters.reset}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="flex items-center justify-center gap-2 rounded-pill px-4 py-3 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            {strings.libraryFilters.apply(selCount)}
          </button>
        </div>
      }
    >
      {!facets ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <div
            aria-hidden
            className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver"
          >
            <div className="h-full w-1/2 animate-pulse bg-tape" />
          </div>
          <p className="text-caption text-muted">{strings.libraryFilters.loadError}</p>
        </div>
      ) : singleSection ? (
        /* ── Quick sheet: just this pill's chips ── */
        <div className="pb-4 pt-1">
          <FacetCloud
            facets={facets}
            id={singleSection}
            draft={draft}
            toggle={toggle}
            showTitle={false}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 pb-4">
          {/* ── Occasion ── */}
          <FacetCloud facets={facets} id="occasion" draft={draft} toggle={toggle} />

          {/* ── Body type ── */}
          <FacetCloud facets={facets} id="body_type" draft={draft} toggle={toggle} />

          {/* ── Celebrity ── */}
          <FacetCloud facets={facets} id="celebrity" draft={draft} toggle={toggle} />

          {/* ── Style catalogue — component accordions ── */}
          <div>
            <SectionTitle title={strings.libraryFilters.catalogueSection} />
            <div className="flex flex-col gap-2">
              {facets.catalog.components.map((comp) => (
                <ComponentAccordion
                  key={comp.id}
                  comp={comp}
                  expanded={!!expanded[comp.id]}
                  onToggle={() =>
                    setExpanded((p) => ({ ...p, [comp.id]: !p[comp.id] }))
                  }
                  draft={draft}
                  toggle={toggle}
                />
              ))}
            </div>
          </div>

          {/* ── Add-ons — one accordion ── */}
          <div>
            <SectionTitle title={strings.libraryFilters.addonsSection} />
            <div className="overflow-hidden rounded-card border border-hairline bg-chalk-white">
              <AccordionHeader
                label="Add-ons"
                count={draft.addon.length + draft.addon_variation.length}
                expanded={!!expanded.__addons}
                onToggle={() =>
                  setExpanded((p) => ({ ...p, __addons: !p.__addons }))
                }
              />
              {expanded.__addons && (
                <div className="flex flex-col gap-3 border-t border-hairline p-3">
                  {facets.catalog.addons.map((ao) => (
                    <div key={ao.id} className="flex flex-col gap-1.5">
                      <Chip
                        label={strings.libraryFilters.anyVariation(ao.labels?.en ?? ao.id)}
                        selected={draft.addon.includes(ao.id)}
                        onClick={() => toggle("addon", ao.id)}
                      />
                      {ao.variations.length > 0 && (
                        <div className="ml-3 flex flex-wrap gap-1.5">
                          {ao.variations.map((av) => (
                            <Chip
                              key={av.id}
                              small
                              label={av.labels?.en ?? av.id}
                              selected={draft.addon_variation.includes(av.id)}
                              onClick={() => toggle("addon_variation", av.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/* ============================================================ */
/*  Subcomponents                                                */
/* ============================================================ */

/** One facet group's chip cloud (Occasion / Body type / Celebrity). */
function FacetCloud({
  facets,
  id,
  draft,
  toggle,
  showTitle = true,
}: {
  facets: LibraryFacetsOut;
  id: QuickFilterSection;
  draft: LibraryFilters;
  toggle: (key: keyof LibraryFilters, value: string) => void;
  showTitle?: boolean;
}) {
  const meta = {
    occasion: {
      title: strings.libraryFilters.occasionSection,
      items: facets.occasions,
      key: "occasion" as const,
    },
    body_type: {
      title: strings.libraryFilters.bodyTypeSection,
      items: facets.body_types,
      key: "body_type" as const,
    },
    celebrity: {
      title: strings.libraryFilters.celebritySection,
      items: facets.celebrities,
      key: "celebrity" as const,
    },
  }[id];

  return (
    <div>
      {showTitle && <SectionTitle title={meta.title} />}
      <div className="flex flex-wrap gap-2">
        {meta.items.map((f: FacetCountOut) => (
          <Chip
            key={f.value}
            label={`${f.value} · ${f.count}`}
            selected={draft[meta.key].includes(f.value)}
            onClick={() => toggle(meta.key, f.value)}
          />
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-eyebrow font-mono uppercase tracking-wider text-muted">
      <Sparkle size={12} className="text-draep-orange" />
      {title}
    </p>
  );
}

function Chip({
  label,
  selected,
  onClick,
  small = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-pill border transition-all active:scale-[0.97] ${
        small ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-caption"
      } ${
        selected
          ? "border-ink-navy bg-ink-navy font-semibold text-chalk-white"
          : "border-hairline-strong bg-chalk-white text-ink-navy hover:border-navy-interactive"
      }`}
    >
      {label}
    </button>
  );
}

function AccordionHeader({
  label,
  count,
  expanded,
  onToggle,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center justify-between px-3 py-2.5 text-left"
    >
      <span className="flex items-center gap-2">
        <span className="text-body font-heading font-semibold text-ink-navy">
          {label}
        </span>
        {count > 0 && (
          <span className="rounded-pill bg-draep-orange px-2 py-0.5 text-[10px] font-semibold text-chalk-white">
            {count}
          </span>
        )}
      </span>
      <ChevronDown
        size={16}
        className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function ComponentAccordion({
  comp,
  expanded,
  onToggle,
  draft,
  toggle,
}: {
  comp: PickerComponentOut;
  expanded: boolean;
  onToggle: () => void;
  draft: LibraryFilters;
  toggle: (key: keyof LibraryFilters, value: string) => void;
}) {
  const count =
    comp.variations.filter((v) => draft.variation.includes(v.id)).length +
    comp.variations.reduce(
      (n, v) =>
        n + v.types.filter((t) => draft.variation_type.includes(t.id)).length,
      0,
    );

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-chalk-white">
      <AccordionHeader
        label={comp.labels?.en ?? comp.id}
        count={count}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className="flex flex-col gap-2.5 border-t border-hairline p-3">
          {comp.variations.map((v) => (
            <div key={v.id} className="flex flex-col gap-1.5">
              <Chip
                label={v.labels?.en ?? v.id}
                selected={draft.variation.includes(v.id)}
                onClick={() => toggle("variation", v.id)}
              />
              {v.types.length > 0 && (
                <div className="ml-3 flex flex-wrap gap-1.5">
                  {v.types.map((t) => (
                    <Chip
                      key={t.id}
                      small
                      label={t.labels?.en ?? t.id}
                      selected={draft.variation_type.includes(t.id)}
                      onClick={() => toggle("variation_type", t.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
