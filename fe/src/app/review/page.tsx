"use client";

/**
 * Review — spec §6.9.
 *
 * Grouped summary list in journey order: Structure → Fit → Add-ons.
 * Each row opens an inline edit sheet (BottomSheet) — no navigation
 * back to the design step. Price breakdown card below the list.
 * Sticky CTA: Continue.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { TapeProgress } from "@/components/layout/TapeProgress";
import { PriceBar } from "@/components/layout/PriceBar";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { BlousePreview } from "@/components/preview/BlousePreview";
import { ReviewRow } from "@/components/review/ReviewRow";
import { ReviewEditSheet } from "@/components/review/ReviewEditSheet";
import { PriceBreakdown } from "@/components/review/PriceBreakdown";
import { CATEGORY_BY_ID, ADDON_BY_ID } from "@/lib/catalog";
import { useBookingStore } from "@/lib/booking-store";
import { OPTION_PRICING } from "@/lib/pricing-config";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { BookingDraft } from "@/types/booking";

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="column flex min-h-dvh items-center justify-center">
          <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
            <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
          </div>
        </div>
      }
    >
      <ReviewContent />
    </Suspense>
  );
}

function ReviewContent() {
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated) track({ event: "review_viewed" });
  }, [hydrated]);

  const structureRows = useMemo(() => buildStructureRows(draft), [draft]);
  const fitRows = useMemo(() => buildFitRows(draft), [draft]);
  const addOnRows = useMemo(() => buildAddOnRows(draft), [draft]);

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  const handleContinue = () => router.push("/contact");

  return (
    <>
      <TapeProgress currentRoute="/review" />

      <ScreenShell hasPriceBar className="pt-4">
        {/* Front + back previews side by side per spec §5.5 */}
        <div className="grid grid-cols-2 gap-3">
          <BlousePreview draft={draft} route="/review" className="aspect-[6/7]" />
        </div>

        <p className="mt-5 eyebrow">Summary</p>
        <h1 className="font-heading text-h1 text-ink-navy">
          {strings.review.title}
        </h1>

        <Section title={strings.review.structureGroup}>
          {structureRows.map((row) => (
            <ReviewRow key={row.testId} {...row} onEdit={setEditingId} />
          ))}
        </Section>

        <Section title={strings.review.fitGroup}>
          {fitRows.map((row) => (
            <ReviewRow key={row.testId} {...row} onEdit={setEditingId} />
          ))}
        </Section>

        <Section title={strings.review.addOnsGroup}>
          {addOnRows.length === 0 ? (
            <button
              type="button"
              onClick={() => setEditingId("__material_addons__")}
              className="flex w-full items-center gap-3 rounded-card border border-hairline bg-chalk-white px-4 py-3 text-left transition-colors hover:border-navy-interactive hover:shadow-card"
            >
              <p className="flex-1 text-body text-muted">
                {strings.review.noAddOns}
              </p>
              <span className="text-caption font-medium text-accent-text">
                {strings.review.editCta}
              </span>
            </button>
          ) : (
            <>
              {addOnRows.map((row) => (
                <ReviewRow key={row.testId} {...row} onEdit={setEditingId} />
              ))}
              <button
                type="button"
                onClick={() => setEditingId("__material_addons__")}
                className="mt-1 w-full rounded-card px-4 py-2.5 text-left text-caption font-medium text-accent-text transition-colors hover:bg-mist-navy"
              >
                + {strings.review.editCta} add-ons
              </button>
            </>
          )}
        </Section>

        <div className="mt-6">
          <p className="eyebrow mb-1">Rate card</p>
          <h2 className="mb-2 font-heading text-h2 text-ink-navy">
            {strings.review.breakdownTitle}
          </h2>
          <PriceBreakdown draft={draft} />
        </div>
      </ScreenShell>

      <PriceBar draft={draft} currentRoute="/review" ctaLabel={strings.review.continue} />

      <ReviewEditSheet editingId={editingId} onClose={() => setEditingId(null)} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-heading text-h3 text-ink-navy">{title}</h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

interface RowData {
  label: string;
  value: string;
  price?: number;
  testId: string;
}

function buildStructureRows(draft: BookingDraft | null): RowData[] {
  if (!draft) return [];
  const ids = ["blouse_cut", "blouse_length", "front_neck", "back_cut", "tying"];
  return ids.map((id) => buildCategoryRow(draft, id));
}

function buildFitRows(draft: BookingDraft | null): RowData[] {
  if (!draft) return [];
  const ids = ["shoulder", "sleeve", "neck_side"];
  return ids.map((id) => buildCategoryRow(draft, id));
}

function buildCategoryRow(draft: BookingDraft, categoryId: string): RowData {
  const category = CATEGORY_BY_ID[categoryId];
  const selection = draft.selections[categoryId];
  const option = category.options.find((o) => o.id === selection?.optionId);
  const sub = option?.subOptions?.find((s) => s.id === selection?.subOptionId);
  const price = option?.priceKey
    ? (OPTION_PRICING[option.priceKey] ?? 0)
    : undefined;

  return {
    label: category.label,
    value: sub ? `${option?.label} · ${sub.label}` : option?.label ?? "—",
    price,
    testId: categoryId,
  };
}

function buildAddOnRows(draft: BookingDraft | null): RowData[] {
  if (!draft) return [];
  const out: RowData[] = [];
  for (const [id, state] of Object.entries(draft.addOns)) {
    if (!state.enabled) continue;
    const addOn = ADDON_BY_ID[id];
    if (!addOn) continue;

    if (addOn.kind === "placements" && state.placements) {
      const placements = Object.keys(state.placements);
      const placementLabels = placements
        .map((pid) => {
          const placement = addOn.placements?.find((p) => p.id === pid);
          const sizeId = state.placements?.[pid]?.sizeId;
          const size = addOn.perPlacementSizes?.find((s) => s.id === sizeId);
          return size ? `${placement?.label} · ${size.label}` : placement?.label;
        })
        .join(", ");
      out.push({
        label: addOn.label,
        value: placementLabels || "None",
        testId: id,
      });
    } else if (addOn.kind === "choice") {
      const choice = addOn.choices?.find((c) => c.id === state.choiceId);
      out.push({
        label: addOn.label,
        value: choice?.label ?? "—",
        testId: id,
      });
    } else {
      out.push({
        label: addOn.label,
        value: "Yes",
        testId: id,
      });
    }
  }
  return out;
}
