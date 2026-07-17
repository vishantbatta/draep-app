"use client";

/**
 * Review — spec §6.9.
 *
 * Grouped summary list in journey order: Structure → Fit → Add-ons.
 * Each row deep-links back to its screen with ?from=review.
 * Price breakdown card below the list (navy table, orange total row).
 * Sticky CTA: Continue.
 *
 * On return from a deep-linked screen, scroll back to the edited row
 * (spec §4 — scroll restoration via element id + scroll: false on navigation).
 */

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { TapeProgress } from "@/components/layout/TapeProgress";
import { PriceBar } from "@/components/layout/PriceBar";
import { ScreenShell } from "@/components/layout/ScreenShell";
import { BlousePreview } from "@/components/preview/BlousePreview";
import { ReviewRow } from "@/components/review/ReviewRow";
import { PriceBreakdown } from "@/components/review/PriceBreakdown";
import { CATALOG, ADD_ONS, CATEGORY_BY_ID, ADDON_BY_ID } from "@/lib/catalog";
import { useBookingStore } from "@/lib/booking-store";
import { computePrice } from "@/lib/pricing";
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
  const params = useSearchParams();
  const returnedFromReview = params.get("from") === "review";

  useEffect(() => {
    if (hydrated) track({ event: "review_viewed" });
  }, [hydrated]);

  // Scroll restoration: on return, scroll to the most-recently-edited row.
  useEffect(() => {
    if (!returnedFromReview || typeof window === "undefined") return;
    const lastEditedId = sessionStorage.getItem("draep:last-review-edit");
    if (!lastEditedId) return;
    const el = document.getElementById(`review-row-${lastEditedId}`);
    if (el) {
      // Give the page a tick to lay out before scrolling.
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }, [returnedFromReview, hydrated]);

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

        <h1 className="mt-5 font-heading text-h1 text-ink-navy">
          {strings.review.title}
        </h1>

        <Section title={strings.review.structureGroup}>
          {structureRows.map((row) => (
            <ReviewRow key={row.testId} {...row} />
          ))}
        </Section>

        <Section title={strings.review.fitGroup}>
          {fitRows.map((row) => (
            <ReviewRow key={row.testId} {...row} />
          ))}
        </Section>

        <Section title={strings.review.addOnsGroup}>
          {addOnRows.length === 0 ? (
            <p className="rounded-card bg-navy-bg px-4 py-3 text-body text-ink-navy/70">
              {strings.review.noAddOns}
            </p>
          ) : (
            addOnRows.map((row) => <ReviewRow key={row.testId} {...row} />)
          )}
        </Section>

        <div className="mt-6">
          <h2 className="mb-2 font-heading text-h2 text-ink-navy">
            {strings.review.breakdownTitle}
          </h2>
          <PriceBreakdown draft={draft} />
        </div>
      </ScreenShell>

      <PriceBar draft={draft} currentRoute="/review" ctaLabel={strings.review.continue} />
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
  route?: string;
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
    route: category.route,
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
        route: "/design/add-ons",
        testId: id,
      });
    } else if (addOn.kind === "choice") {
      const choice = addOn.choices?.find((c) => c.id === state.choiceId);
      out.push({
        label: addOn.label,
        value: choice?.label ?? "—",
        route: addOn.contextRoutes?.[0] ?? "/design/add-ons",
        testId: id,
      });
    } else {
      out.push({
        label: addOn.label,
        value: "Yes",
        route: addOn.contextRoutes?.[0] ?? "/design/add-ons",
        testId: id,
      });
    }
  }
  return out;
}
