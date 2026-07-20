"use client";

/**
 * BlousePreview — layered SVG blouse (spec §5.5).
 *
 * Renders the current draft on a 240×280 SVG with:
 *   - Base blouse silhouette (front or back)
 *   - All active layers stacked by z-order from layerManifest
 *   - Front/back flip control with a single tap
 *   - 50% opacity ghost preview via the `pendingLayer` slot (single tree,
 *     not a parallel ghost component)
 *   - Curl In (500ms) on apply
 *   - Auto-flip to relevant view per route (DEFAULT_VIEW_PER_ROUTE)
 *
 * Active layer = the "current" element being edited highlights in Draep Orange
 * (Brand Book §6 iconography — orange active state).
 *
 * Reduced motion: Framer Motion respects prefers-reduced-motion automatically.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { clsx } from "clsx";

import {
  DEFAULT_VIEW_PER_ROUTE,
  PreviewView,
  sortByZ,
  findLayer,
} from "@/components/preview/layerManifest";
import {
  BaseBlouseBack,
  BaseBlouseFront,
  PREVIEW_VIEWBOX,
  renderLayer,
} from "@/components/preview/layers";
import { Flip } from "@/components/ui/icons";
import type { BookingDraft } from "@/types/booking";
import { addOnLayerId, selectionLayerId } from "@/components/preview/layerManifest";
import { ADDON_BY_ID } from "@/lib/catalog";
import { strings } from "@/lib/strings";

interface BlousePreviewProps {
  draft: BookingDraft;
  /** Route determines the default view (front vs back). */
  route?: string;
  /** Layer id currently being hovered/pressed — renders at 50% opacity. */
  pendingLayerId?: string | null;
  /** Layer id of the element being edited on this screen — highlights orange. */
  activeLayerPrefix?: string | null;
  className?: string;
}

/** Collect all layer ids active for a draft, per view (filtered by manifest). */
function collectLayerIds(draft: BookingDraft): { front: string[]; back: string[] } {
  const candidates: string[] = [];

  for (const [categoryId, selection] of Object.entries(draft.selections)) {
    // Prefer the composite id (with subOption) so per-suboption renderers fire,
    // fall back to the option-level id.
    const composite = selectionLayerId(categoryId, selection.optionId, selection.subOptionId);
    const base = selectionLayerId(categoryId, selection.optionId);
    candidates.push(composite, base);
  }

  for (const [addOnId, state] of Object.entries(draft.addOns)) {
    if (!state.enabled) continue;
    const addOn = ADDON_BY_ID[addOnId];
    if (!addOn) continue;

    if (addOn.kind === "placements" && state.placements) {
      for (const placementId of Object.keys(state.placements)) {
        candidates.push(addOnLayerId(addOnId, placementId));
      }
    } else {
      candidates.push(addOnLayerId(addOnId));
    }
  }

  // Split by view using the manifest — only layers declared for a view render there.
  const front: string[] = [];
  const back: string[] = [];
  const seenFront = new Set<string>();
  const seenBack = new Set<string>();

  for (const id of candidates) {
    const descriptor = findLayer(id);
    if (!descriptor) continue;
    if (descriptor.view === "front" && !seenFront.has(id)) {
      front.push(id);
      seenFront.add(id);
    } else if (descriptor.view === "back" && !seenBack.has(id)) {
      back.push(id);
      seenBack.add(id);
    }
  }

  return { front, back };
}

export function BlousePreview({
  draft,
  route,
  pendingLayerId,
  activeLayerPrefix,
  className,
}: BlousePreviewProps) {
  const initialView: PreviewView =
    (route && DEFAULT_VIEW_PER_ROUTE[route]) || "front";
  const [view, setView] = useState<PreviewView>(initialView);

  // Auto-flip when route changes
  useEffect(() => {
    if (route && DEFAULT_VIEW_PER_ROUTE[route]) {
      setView(DEFAULT_VIEW_PER_ROUTE[route]);
    }
  }, [route]);

  const layerIds = useMemo(() => collectLayerIds(draft), [draft]);

  const visibleLayers = useMemo(() => {
    const ids = view === "front" ? layerIds.front : layerIds.back;
    return sortByZ(ids, view)
      .map((id) => ({
        id,
        node: renderLayer(id),
      }))
      .filter((l) => l.node !== null && l.node !== undefined);
  }, [view, layerIds]);

  const ariaLabel = useMemo(() => {
    // Build a spoken description for AT users (a11y §11).
    const description = visibleLayers
      .map((l) => l.id.replace(/[:_]/g, " "))
      .join(", ");
    return strings.preview.label(description || "blank");
  }, [visibleLayers]);

  const pendingNode = pendingLayerId ? renderLayer(pendingLayerId) : null;

  const flip = useCallback(() => {
    setView((v) => (v === "front" ? "back" : "front"));
  }, []);

  return (
    <section
      className={clsx(
        "relative overflow-hidden rounded-card bg-mist-navy shadow-brand",
        className,
      )}
      aria-label={ariaLabel}
    >
      <div className="mx-auto w-full" style={{ maxWidth: "40vh", maxHeight: "35vh" }}>
        <svg
          viewBox={`0 0 ${PREVIEW_VIEWBOX.width} ${PREVIEW_VIEWBOX.height}`}
          className="block h-[35vh] max-h-[280px] w-full"
          role="img"
          aria-label={ariaLabel}
        >
          <rect
            x={0}
            y={0}
            width={PREVIEW_VIEWBOX.width}
            height={PREVIEW_VIEWBOX.height}
            fill="var(--mist-navy)"
          />

          {/* Base silhouette */}
          {view === "front" ? <BaseBlouseFront /> : <BaseBlouseBack />}

          {/* Stacked layers — solid render; active layer gets orange via currentColor.
              We keep a single lightweight CSS transition on the group rather than
              per-layer motion to avoid jank on route change. */}
          <g
            style={{
              color: "var(--ink-navy)",
              transition: "color 200ms ease",
            }}
          >
            {visibleLayers.map((layer) => {
              const isActive = activeLayerPrefix && layer.id.startsWith(activeLayerPrefix);
              return (
                <g key={layer.id} style={{ color: isActive ? "var(--draep-orange)" : "var(--ink-navy)" }}>
                  {layer.node}
                </g>
              );
            })}
          </g>

          {/* Pending (ghost-preview) layer — single tree, not a parallel component */}
          {pendingNode && (
            <g style={{ opacity: 0.5, color: "var(--draep-orange)" }}>
              {pendingNode}
            </g>
          )}
        </svg>
      </div>

      {/* Flip control — bottom-right of the preview */}
      <button
        type="button"
        onClick={flip}
        aria-label={view === "front" ? strings.preview.flipToBack : strings.preview.flipToFront}
        className="tap absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-pill bg-chalk-white px-3 py-1.5 text-caption font-medium text-ink-navy shadow-brand"
      >
        <Flip size={14} />
        {view === "front" ? "Back" : "Front"}
      </button>

      {/* Live region — announce only on apply, not on ghost-preview (per plan). */}
      <span className="sr-only" aria-live="polite">
        {view === "front" ? "Front view" : "Back view"}: {visibleLayers.length} layers active.
      </span>
    </section>
  );
}
