"use client";

import { useState } from "react";
import type { SCMetric } from "@/lib/style-captain-api";
import { pickLabel } from "@/lib/sc-helpers";

const LANG_ORDER = ["en", "hi", "kn", "ta", "te"];
const LANG_TAGS: Record<string, string> = { en: "EN", hi: "हि", kn: "ಕ" };

/**
 * Renders a single measurement metric with multilingual labels + descriptions,
 * and an expandable reference image.
 *
 * The value input is NOT rendered here — it lives in the sticky footer
 * alongside the CTA buttons in the parent page.
 */
export interface MetricDraft {
  metricId: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
}

export function MetricCard({
  metric,
}: {
  metric: SCMetric;
  draft: MetricDraft;
  onChange: (next: MetricDraft) => void;
}) {
  const labels = metric.labels ?? {};
  const descriptions = metric.descriptions ?? {};
  const primary = pickLabel(labels, metric.code ?? "Metric");
  const image = metric.asset_urls?.[0] ?? null;
  const activeLangs = LANG_ORDER.filter((l) => labels[l] || descriptions[l]);
  const [activeLang, setActiveLang] = useState("en");
  const [imageZoomed, setImageZoomed] = useState(false);

  const labelText = labels[activeLang];
  const descText = descriptions[activeLang];

  return (
    <>
      <div className="flex h-full flex-col gap-2">
        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-h4 font-semibold leading-tight text-ink-navy">
            {primary}
          </h2>
          {metric.code && (
            <span className="shrink-0 font-mono text-[10px] text-muted">
              {metric.code}
            </span>
          )}
        </div>

        {/* ─── Reference image (tap to expand) ────────────────────────────── */}
        {image && (
          <button
            onClick={() => setImageZoomed(true)}
            className="tap relative overflow-hidden rounded-card border border-hairline"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt={primary}
              className="max-h-60 w-full bg-warm-sand object-contain"
            />
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-ink-navy/70 px-2 py-0.5 text-[9px] font-medium text-chalk-white">
              Tap to expand
            </span>
          </button>
        )}

        {/* ─── Language tabs + single language text ──────────────────────── */}
        {activeLangs.length > 0 && (
          <div>
            {/* Tabs */}
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

            {/* Active language text */}
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
      </div>

      {/* ─── Fullscreen image overlay ─────────────────────────────────────── */}
      {imageZoomed && image && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-navy/90 backdrop-blur-sm"
          onClick={() => setImageZoomed(false)}
        >
          <button
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-chalk-white/20 text-chalk-white"
            onClick={() => setImageZoomed(false)}
            aria-label="Close"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={primary}
            className="max-h-[90vh] max-w-[95vw] rounded-card object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

// ─── Sticky input bar ──────────────────────────────────────────────────────
//
// Renders the value input + unit selector + CTA buttons in a single sticky
// footer. The parent passes the draft, onChange, and nav handlers.

export function MetricInputBar({
  draft,
  onChange,
  isLastStep,
  onBack,
  onNext,
  onReview,
}: {
  draft: MetricDraft;
  onChange: (next: MetricDraft) => void;
  isLastStep: boolean;
  onBack: () => void;
  onNext: () => void;
  onReview: () => void;
}) {
  function handleNumeric(v: string) {
    const trimmed = v.trim();
    if (trimmed === "") {
      onChange({ ...draft, valueNumeric: null, valueText: null, unit: "in" });
      return;
    }
    const n = Number(trimmed);
    if (Number.isNaN(n)) return;
    onChange({ ...draft, valueNumeric: n, valueText: null, unit: "in" });
  }

  const hasValue = draft.valueNumeric !== null;

  return (
    <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-[480px] space-y-2.5">
        {/* Input row */}
        <div className="rounded-card border border-hairline bg-chalk-white px-3 py-2.5 shadow-card">
          <label className="mb-2 block text-[11px] font-medium text-ink-navy">
            Reading (inches)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={draft.valueNumeric ?? ""}
              onChange={(e) => handleNumeric(e.target.value)}
              placeholder="0.0"
              autoFocus
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body font-medium text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
            <span className="shrink-0 rounded-card bg-mist-navy px-3 py-2 text-body font-semibold text-ink-navy">
              in
            </span>
          </div>
        </div>

        {/* CTA row */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
          >
            Back
          </button>
          {isLastStep ? (
            <button
              onClick={onReview}
              disabled={!hasValue}
              className="tap flex-[2] rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white disabled:opacity-40"
            >
              Review →
            </button>
          ) : (
            <button
              onClick={onNext}
              disabled={!hasValue}
              className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-40"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
