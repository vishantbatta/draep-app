"use client";

import { useEffect, useState } from "react";
import type { SCMetric } from "@/lib/style-captain-api";
import { pickLabel } from "@/lib/sc-helpers";
import type { MetricDraft } from "@/components/style-captain/MetricCard";

const LANG_ORDER = ["en", "hi", "kn", "ta", "te"];
const LANG_TAGS: Record<string, string> = { en: "EN", hi: "हि", kn: "ಕ" };

/**
 * Bottom sheet for inline-editing a metric's value from the review screen.
 *
 * Slides up from the bottom, shows the image + multilingual text (tab switch),
 * and a value input. Calls onChange with the updated draft. The Done button
 * closes the sheet.
 */
export function EditMetricSheet({
  metric,
  draft,
  garmentLabel,
  onChange,
  onClose,
}: {
  metric: SCMetric;
  draft: MetricDraft;
  /** Garment instance this reading belongs to ("Blouse 2") — shown as an
   *  eyebrow when the metric is garment-scoped; omitted for base readings. */
  garmentLabel?: string;
  onChange: (next: MetricDraft) => void;
  onClose: () => void;
}) {
  const labels = metric.labels ?? {};
  const descriptions = metric.descriptions ?? {};
  const primary = pickLabel(labels, metric.code ?? "Metric");
  const image = metric.asset_urls?.[0] ?? null;
  const activeLangs = LANG_ORDER.filter((l) => labels[l] || descriptions[l]);
  const [activeLang, setActiveLang] = useState("en");

  // Lock body scroll while sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const labelText = labels[activeLang];
  const descText = descriptions[activeLang];

  // Local string state so the user can type intermediate values like "34." freely
  const [inputStr, setInputStr] = useState<string>(
    draft.valueNumeric !== null ? String(draft.valueNumeric) : "",
  );

  function handleNumeric(v: string) {
    // Allow only valid numeric characters (digits and one dot)
    if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
    setInputStr(v);
    const trimmed = v.trim();
    if (trimmed === "" || trimmed === ".") {
      onChange({ ...draft, valueNumeric: null, valueText: null });
      return;
    }
    const n = Number(trimmed);
    if (Number.isNaN(n)) return;
    onChange({ ...draft, valueNumeric: n, valueText: null });
  }

  function commitNumeric() {
    const n = Number(inputStr);
    if (inputStr.trim() !== "" && !Number.isNaN(n)) {
      onChange({ ...draft, valueNumeric: n, valueText: null });
      setInputStr(String(n));
    }
  }

  function handleText(v: string) {
    onChange({ ...draft, valueText: v || null, valueNumeric: null });
  }

  const isTextMetric = draft.valueText !== null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-navy/50 backdrop-blur-sm"
      />

      {/* Sheet */}
      <div className="relative z-10 max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-[1.5rem] border border-hairline bg-chalk-white shadow-2xl animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full bg-hairline-strong" />
        </div>

        <div className="space-y-3 px-4 pb-6 pt-2">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {garmentLabel && (
                <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                  {garmentLabel}
                </p>
              )}
              <h2 className="font-heading text-h4 font-semibold leading-tight text-ink-navy">
                {primary}
              </h2>
              {metric.code && (
                <span className="font-mono text-[10px] text-muted">
                  {metric.code}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="tap shrink-0 rounded-pill bg-mist-navy px-3 py-1 text-[12px] font-medium text-ink-navy"
            >
              Done
            </button>
          </div>

          {/* Image */}
          {image && (
            <div className="overflow-hidden rounded-card border border-hairline">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt={primary}
                className="max-h-48 w-full bg-warm-sand object-contain"
              />
            </div>
          )}

          {/* Language tabs */}
          {activeLangs.length > 0 && (
            <div>
              <div className="flex gap-1">
                {activeLangs.map((lang) => {
                  const isActive = lang === activeLang;
                  const isEn = lang === "en";
                  return (
                    <button
                      key={lang}
                      onClick={() => setActiveLang(lang)}
                      className={`tap flex-1 rounded-pill px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ${
                        isActive
                          ? isEn
                            ? "bg-accent-text text-chalk-white shadow-card"
                            : "bg-ink-navy text-chalk-white shadow-card"
                          : "bg-mist-navy text-muted"
                      }`}
                    >
                      {LANG_TAGS[lang] ?? lang}
                    </button>
                  );
                })}
              </div>

              {(labelText || descText) && (
                <div className="mt-1.5 rounded-lg bg-mist-navy/60 px-3 py-2">
                  {labelText && (
                    <span
                      className={`block font-semibold text-ink-navy ${
                        activeLang === "en" ? "text-sm" : "text-[12px]"
                      }`}
                    >
                      {labelText}
                    </span>
                  )}
                  {descText && (
                    <p
                      className={`mt-0.5 leading-snug text-ink ${
                        activeLang === "en" ? "text-[13px]" : "text-[11px]"
                      }`}
                    >
                      {descText}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Value input */}
          <div className="rounded-card border border-hairline bg-chalk-white px-3 py-2.5 shadow-card">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[11px] font-medium text-ink-navy">
                Reading
              </label>
              <div className="flex gap-1 rounded-pill bg-mist-navy p-0.5">
                <button
                  onClick={() => onChange({ ...draft, valueText: null })}
                  className={`tap rounded-pill px-2.5 py-0.5 text-[10px] font-medium transition ${
                    !isTextMetric
                      ? "bg-chalk-white text-ink-navy shadow-card"
                      : "text-muted"
                  }`}
                >
                  Number
                </button>
                <button
                  onClick={() =>
                    onChange({
                      ...draft,
                      valueNumeric: null,
                      valueText: draft.valueText ?? "",
                    })
                  }
                  className={`tap rounded-pill px-2.5 py-0.5 text-[10px] font-medium transition ${
                    isTextMetric
                      ? "bg-chalk-white text-ink-navy shadow-card"
                      : "text-muted"
                  }`}
                >
                  Text
                </button>
              </div>
            </div>

            {isTextMetric ? (
              <input
                type="text"
                value={draft.valueText ?? ""}
                onChange={(e) => handleText(e.target.value)}
                placeholder="e.g. C cup"
                autoFocus
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body font-medium text-ink outline-none focus:border-tape focus:ring-2 focus:ring-tape/30"
              />
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputStr}
                  onChange={(e) => handleNumeric(e.target.value)}
                  onBlur={commitNumeric}
                  placeholder="0.0"
                  autoFocus
                  className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body font-medium text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
                />
                <select
                  value={draft.unit ?? metric.unit ?? "in"}
                  onChange={(e) =>
                    onChange({ ...draft, unit: e.target.value })
                  }
                  className="shrink-0 rounded-card border border-hairline-strong bg-chalk-white px-2.5 py-2 text-[12px] font-medium text-ink-navy outline-none focus:border-accent-text"
                >
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
