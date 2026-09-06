"use client";

/**
 * PromoSettingsCard — the global promo configuration (kill switch,
 * stacking, rounding, code shape), rendered as the "Settings" view of
 * the Promotions page. Moved here from the old /promotions/config route
 * so everything promo-related lives on one page.
 */

import { useEffect, useState } from "react";
import {
  getPromoSettings,
  updatePromoSettings,
  type PromoSettings,
} from "@/lib/admin-api";

interface ConfigDraft {
  globalEnabled: boolean;
  stackingMode: "single" | "multi";
  maxStack: number;
  roundingMode: "half_up" | "floor";
  codePrefix: string;
  codeLength: number;
}

const DEFAULT_DRAFT: ConfigDraft = {
  globalEnabled: true,
  stackingMode: "single",
  maxStack: 1,
  roundingMode: "half_up",
  codePrefix: "DRAEP",
  codeLength: 4,
};

function draftFromSettings(s: PromoSettings): ConfigDraft {
  return {
    globalEnabled: s.global_enabled !== false,
    stackingMode: s.stacking_mode === "multi" ? "multi" : "single",
    maxStack: Math.min(10, Math.max(1, s.max_stack ?? 1)),
    roundingMode: s.rounding_mode === "floor" ? "floor" : "half_up",
    codePrefix: s.code_prefix ?? "DRAEP",
    codeLength: Math.min(16, Math.max(3, s.code_length ?? 4)),
  };
}

export function PromoSettingsCard() {
  const [draft, setDraft] = useState<ConfigDraft>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    getPromoSettings()
      .then((s) => {
        setDraft(draftFromSettings(s));
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load promo settings");
        setLoading(false);
      });
  }, []);

  function patch<K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSavedAt(null);
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const s = await updatePromoSettings({
        global_enabled: draft.globalEnabled,
        stacking_mode: draft.stackingMode,
        max_stack: draft.stackingMode === "multi" ? draft.maxStack : 1,
        rounding_mode: draft.roundingMode,
        code_prefix: draft.codePrefix.trim().toUpperCase() || "DRAEP",
        code_length: draft.codeLength,
      });
      setDraft(draftFromSettings(s));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save promo settings");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";
  const labelCls = "mb-1.5 block font-mono text-eyebrow text-ink-navy";
  const hintCls = "mt-1 text-[11px] text-muted";

  function Choice<T extends string>(props: {
    value: T;
    options: readonly { v: T; label: string }[];
    onSelect: (v: T) => void;
  }) {
    return (
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => props.onSelect(o.v)}
            className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition ${
              props.value === o.v
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
        <span className="text-caption text-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      <div className="space-y-6 rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
        {/* Kill switch */}
        <section
          className={`rounded-card border p-4 ${
            draft.globalEnabled ? "border-hairline bg-mist-navy/30" : "border-error-border bg-error-bg/50"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-eyebrow text-ink-navy">Master switch</p>
              <p className="mt-1 text-caption text-muted">
                Off pauses every coupon and sale instantly — carts re-price without any discount.
              </p>
            </div>
            <Choice
              value={draft.globalEnabled ? "on" : "off"}
              options={[
                { v: "on", label: "On" },
                { v: "off", label: "Off" },
              ]}
              onSelect={(v) => patch("globalEnabled", v === "on")}
            />
          </div>
        </section>

        {/* Stacking */}
        <section>
          <label className={labelCls}>Stacking</label>
          <Choice
            value={draft.stackingMode}
            options={[
              { v: "single", label: "Best single" },
              { v: "multi", label: "Stack up to N" },
            ]}
            onSelect={(v) => patch("stackingMode", v)}
          />
          <p className={hintCls}>
            Best single: the highest-priority (then biggest) discount wins. Stack: coupons and
            sales combine, cheapest-to-give order, capped below.
          </p>
          {draft.stackingMode === "multi" && (
            <div className="mt-3 max-w-[160px]">
              <label className={labelCls}>Max stacked (1–10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.maxStack}
                onChange={(e) =>
                  patch("maxStack", Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)))
                }
                className={inputCls}
              />
            </div>
          )}
        </section>

        {/* Rounding */}
        <section>
          <label className={labelCls}>Percent rounding</label>
          <Choice
            value={draft.roundingMode}
            options={[
              { v: "half_up", label: "Round half up" },
              { v: "floor", label: "Round down" },
            ]}
            onSelect={(v) => patch("roundingMode", v)}
          />
          <p className={hintCls}>
            How odd rupees from percent discounts settle — half-up is customer-friendly, floor
            favours the house.
          </p>
        </section>

        {/* Code shape */}
        <section>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls}>Code prefix</label>
              <input
                type="text"
                min={1}
                maxLength={16}
                value={draft.codePrefix}
                onChange={(e) => patch("codePrefix", e.target.value.toUpperCase())}
                className={`${inputCls} font-mono`}
              />
              <p className={hintCls}>Generated codes look like {draft.codePrefix || "DRAEP"}-XY2A.</p>
            </div>
            <div>
              <label className={labelCls}>Code length (3–16)</label>
              <input
                type="number"
                min={3}
                max={16}
                value={draft.codeLength}
                onChange={(e) =>
                  patch("codeLength", Math.min(16, Math.max(3, parseInt(e.target.value, 10) || 4)))
                }
                className={inputCls}
              />
              <p className={hintCls}>Random characters after the prefix.</p>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {savedAt && !error && (
            <span className="rounded-pill bg-accent-text/10 px-3 py-1 text-caption font-medium text-accent-text">
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
