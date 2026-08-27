/**
 * Session-scoped draft persistence for the MYOD wizard.
 *
 * Every selection change and finished render is mirrored into
 * sessionStorage, so a refresh (or an accidental back) restores the design
 * in progress. Deliberately sessionStorage — it survives refreshes and tab
 * restores but dies with the tab, so it can never become a stale
 * "cross-day" state surprise. The real draft (bookable, cross-device) is
 * the pending order created by Complete Order.
 *
 * Stored selections are sanitized against the live catalog on restore: a
 * component or option an admin deleted since simply drops out instead of
 * rendering a broken card.
 */

import type { MyodRenderView } from "./api/myod";
import type { DesignStep, Selections } from "./myod-steps";

const KEY = "myod:draft:v1";

type MyodDraft = {
  garmentId: string;
  selections: Selections;
  renderViews: MyodRenderView[];
};

export function saveMyodDraft(draft: MyodDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Private mode / quota — a draft is a nicety, never worth breaking a tap.
  }
}

export function loadMyodDraft(
  garmentId: string,
): { selections: Selections; renderViews: MyodRenderView[] } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MyodDraft>;
    if (parsed.garmentId !== garmentId) return null;
    return {
      selections: parsed.selections ?? {},
      renderViews: Array.isArray(parsed.renderViews)
        ? parsed.renderViews.filter((v) => v?.view && v?.url)
        : [],
    };
  } catch {
    return null;
  }
}

export function clearMyodDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Same as save — best effort.
  }
}

/** Keep only selections whose component AND chosen option(s) still exist in
 *  the live catalog — stale ids from an admin edit drop out silently. */
export function sanitizeMyodSelections(
  saved: Selections,
  steps: DesignStep[],
): Selections {
  const out: Selections = {};
  for (const step of steps) {
    for (const c of step.components) {
      const sel = saved[c.id];
      if (!sel) continue;
      if (c.kind === "toggle" || c.options.length === 0) {
        // Toggles only ever carry the on/off markers.
        if (sel.variationId === "__toggle_on__" || sel.variationId === "__off__")
          out[c.id] = sel;
        continue;
      }
      const known = new Set(c.options.map((o) => o.id));
      if (sel.picks?.length) {
        const picks = sel.picks.filter((p) => known.has(p.variationId));
        if (picks.length) out[c.id] = { ...sel, picks };
        continue;
      }
      if (known.has(sel.variationId)) out[c.id] = sel;
    }
  }
  return out;
}
