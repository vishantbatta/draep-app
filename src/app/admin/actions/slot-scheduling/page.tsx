"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSchedulingSettings,
  patchSchedulingSettings,
  type SchedulingSettings,
} from "@/lib/admin-api";

// ─── Sub-tabs for Actions (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "garments", label: "Garments", href: "/admin/actions/garments" },
  { key: "style-components", label: "Style Components", href: "/admin/actions/style-components" },
  { key: "variations", label: "Variations", href: "/admin/actions/variations" },
  { key: "variation-types", label: "Variation Types", href: "/admin/actions/variation-types" },
  { key: "addons", label: "Add-ons", href: "/admin/actions/addons" },
  { key: "addon-variations", label: "Add-on Variations", href: "/admin/actions/addon-variations" },
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

export default function SlotSchedulingActionPage() {
  return (
    <Suspense fallback={null}>
      <SlotSchedulingActionPageInner />
    </Suspense>
  );
}

const GRID_OPTIONS = [15, 30, 45, 60] as const;

function SlotSchedulingActionPageInner() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("slot-scheduling");

  const [settings, setSettings] = useState<SchedulingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: activeActionTab === t.key,
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [activeActionTab, router]);

  // ─── Load settings ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    getSchedulingSettings()
      .then((s) => {
        setSettings(s);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load scheduling settings");
        setLoading(false);
      });
  }, []);

  // Local editable draft. Numbers are edited as strings so the user can clear
  // the box while typing; parsed on save.
  const [draft, setDraft] = useState<SchedulingSettings | null>(null);
  useEffect(() => {
    if (settings) setDraft({ ...settings });
  }, [settings]);

  if (loading || !draft) {
    return (
      <div className="px-4 py-4 md:px-6 md:py-6">
        <h1 className="mb-4 font-heading text-h3 font-semibold text-ink-navy md:text-h2">
          Slot Scheduling
        </h1>
        {error ? (
          <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
            {error}
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
            <span className="text-caption text-muted">Loading…</span>
          </div>
        )}
      </div>
    );
  }

  const inputCls =
    "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";

  function patch<K extends keyof SchedulingSettings>(key: K, value: SchedulingSettings[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSavedAt(null);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    patchSchedulingSettings({
      slot_minutes: draft.slot_minutes,
      buffer_minutes: draft.buffer_minutes,
      visit_minutes: draft.visit_minutes,
      lead_time_minutes: draft.lead_time_minutes,
      reschedule_cutoff_minutes: draft.reschedule_cutoff_minutes,
      booking_horizon_days: draft.booking_horizon_days,
    })
      .then((s) => {
        setSettings(s);
        setDraft({ ...s });
        setSaving(false);
        setSavedAt(Date.now());
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to save scheduling settings");
        setSaving(false);
      });
  }

  // Derived helper figures for the UI
  const bufferPhysMins = draft.buffer_minutes * draft.slot_minutes;
  const visitSteps = draft.slot_minutes > 0 ? draft.visit_minutes / draft.slot_minutes : 0;
  const visitMisaligned =
    draft.slot_minutes > 0 && draft.visit_minutes % draft.slot_minutes !== 0;

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">
          Slot Scheduling
        </h1>
        {savedAt && !error && (
          <span className="rounded-pill bg-accent-text/10 px-3 py-1 text-caption font-medium text-accent-text">
            Saved
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      <form onSubmit={handleSave} className="max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
        {/* Grid length */}
        <div className="mb-6">
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Grid Length
          </label>
          <p className="mb-2.5 text-[12px] text-muted">
            How often a bookable start chip appears to the customer.
          </p>
          <div className="flex flex-wrap gap-2">
            {GRID_OPTIONS.map((g) => {
              const active = draft.slot_minutes === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => patch("slot_minutes", g)}
                  className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition ${
                    active
                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                      : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                  }`}
                >
                  {g} min
                </button>
              );
            })}
          </div>
        </div>

        {/* Visit length */}
        <div className="mb-6">
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Measurement Job / Visit Length (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={draft.visit_minutes}
            onChange={(e) => patch("visit_minutes", parseInt(e.target.value || "0", 10) || 0)}
            className={`${inputCls} ${visitMisaligned ? "border-error-border" : ""}`}
          />
          <p className={`mt-1 text-[11px] ${visitMisaligned ? "text-error-text" : "text-muted"}`}>
            {visitMisaligned
              ? `Must be a whole multiple of grid (${draft.slot_minutes} min).`
              : `= ${visitSteps} grid step${visitSteps === 1 ? "" : "s"} per visit.`}
          </p>
        </div>

        {/* Buffer */}
        <div className="mb-6">
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Buffer (grid steps, before &amp; after)
          </label>
          <input
            type="number"
            min={0}
            value={draft.buffer_minutes}
            onChange={(e) => patch("buffer_minutes", parseInt(e.target.value || "0", 10) || 0)}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-muted">
            Blocks this many grid steps before AND after each visit (= {bufferPhysMins} min).
          </p>
        </div>

        {/* Lead / cutoff / horizon */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Lead Time (min)
            </label>
            <input
              type="number"
              min={0}
              value={draft.lead_time_minutes}
              onChange={(e) => patch("lead_time_minutes", parseInt(e.target.value || "0", 10) || 0)}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted">Earliest bookable start from now.</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Reschedule Cutoff (min)
            </label>
            <input
              type="number"
              min={0}
              value={draft.reschedule_cutoff_minutes}
              onChange={(e) =>
                patch("reschedule_cutoff_minutes", parseInt(e.target.value || "0", 10) || 0)
              }
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted">How soon before a slot reschedule is blocked.</p>
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Booking Horizon (days)
            </label>
            <input
              type="number"
              min={1}
              value={draft.booking_horizon_days}
              onChange={(e) =>
                patch("booking_horizon_days", parseInt(e.target.value || "1", 10) || 1)
              }
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-muted">How far ahead slots are offered.</p>
          </div>
        </div>

        {/* Timezone (read-only) */}
        <div className="mb-6">
          <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
            Timezone
          </label>
          <input
            type="text"
            value={draft.scheduling_timezone}
            disabled
            className={`${inputCls} cursor-not-allowed opacity-60`}
          />
          <p className="mt-1 text-[11px] text-muted">Single-zone V0. Not editable here.</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving || visitMisaligned}
            className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {visitMisaligned && (
            <span className="text-[12px] text-error-text">
              Fix the visit/grid mismatch before saving.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
