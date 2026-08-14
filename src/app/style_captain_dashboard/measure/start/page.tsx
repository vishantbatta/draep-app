"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  scCreateWalkInJob,
  scFetchCatalogueGarments,
  type SCGarmentBrief,
} from "@/lib/style-captain-api";
import { pickLabel } from "@/lib/sc-helpers";

/**
 * Walk-in measurement start — captures customer name + phone + the intended
 * garment type. If the user doesn't exist, the backend creates one
 * automatically. The garment type drives the measurement checklist (a real
 * order + garment order are created server-side), so the wizard resolves the
 * right metrics immediately. A new in-progress measurement job is created and
 * the captain is taken straight into the measurement flow.
 */
export default function MeasureStartPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [garments, setGarments] = useState<SCGarmentBrief[]>([]);
  const [garmentId, setGarmentId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Garment-type picker options
  useEffect(() => {
    scFetchCatalogueGarments()
      .then((rows) => {
        setGarments(rows);
        if (rows.length > 0) setGarmentId((cur) => cur || rows[0].id);
      })
      .catch(() => {
        /* picker starts empty — submit stays disabled */
      });
  }, []);

  const phoneValid = /^\d{10}$/.test(phone.replace(/\s+/g, ""));
  const nameValid = name.trim().length >= 2;
  const canSubmit = phoneValid && nameValid && !!garmentId && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    try {
      const result = await scCreateWalkInJob(
        name.trim(),
        phone.replace(/\s+/g, ""),
        garmentId,
        notes.trim() || undefined,
      );
      router.push(
        `/style_captain_dashboard/measure/${result.job_id}`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create walk-in job",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="tap flex h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-chalk-white text-ink-navy"
          aria-label="Back"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
            <path
              d="M13 5l-5 5 5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div>
          <p className="text-eyebrow uppercase tracking-wider text-accent-text">
            Walk-in customer
          </p>
          <h1 className="font-heading text-h4 font-semibold text-ink-navy">
            New measurement
          </h1>
        </div>
      </div>

      <p className="text-body text-muted">
        Enter the customer&apos;s details to start a measurement session. If
        they&apos;re new, an account will be created automatically.
      </p>

      {error && (
        <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {/* Walk-in form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          {/* Name */}
          <div>
            <label
              htmlFor="walk-in-name"
              className="mb-1 block text-caption font-medium text-ink-navy"
            >
              Customer name <span className="text-error-text">*</span>
            </label>
            <input
              id="walk-in-name"
              type="text"
              inputMode="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aarav Sharma"
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
          </div>

          {/* Phone */}
          <div className="mt-4">
            <label
              htmlFor="walk-in-phone"
              className="mb-1 block text-caption font-medium text-ink-navy"
            >
              Phone number <span className="text-error-text">*</span>
            </label>
            <div className="flex items-stretch gap-2">
              <span className="flex shrink-0 items-center rounded-card border border-hairline-strong bg-mist-navy px-3 text-body font-medium text-muted">
                +91
              </span>
              <input
                id="walk-in-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                placeholder="10-digit mobile"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
              />
            </div>
            {phone.length > 0 && !phoneValid && (
              <p className="mt-1 text-[11px] text-error-text">
                Enter a valid 10-digit phone number.
              </p>
            )}
          </div>

          {/* Garment type — drives the checklist */}
          <div className="mt-4">
            <label
              htmlFor="walk-in-garment"
              className="mb-1 block text-caption font-medium text-ink-navy"
            >
              Garment type <span className="text-error-text">*</span>
            </label>
            <select
              id="walk-in-garment"
              value={garmentId}
              onChange={(e) => setGarmentId(e.target.value)}
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            >
              {garments.length === 0 && <option value="">Loading garments…</option>}
              {garments.map((g) => (
                <option key={g.id} value={g.id}>
                  {pickLabel(g.labels, g.slug ?? "Garment")}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              Sets which measurements the checklist asks for.
            </p>
          </div>

          {/* Notes (optional) */}
          <div className="mt-4">
            <label
              htmlFor="walk-in-notes"
              className="mb-1 block text-caption font-medium text-ink-navy"
            >
              Notes <span className="text-muted">(optional)</span>
            </label>
            <textarea
              id="walk-in-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any special requests or context…"
              className="w-full resize-none rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="tap w-full rounded-pill bg-tape px-4 py-4 text-body font-semibold text-chalk-white shadow-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Creating session…" : "Start measurement →"}
        </button>

        {!nameValid && name.length > 0 && (
          <p className="text-center text-[11px] text-muted">
            Name must be at least 2 characters.
          </p>
        )}
      </form>
    </div>
  );
}
