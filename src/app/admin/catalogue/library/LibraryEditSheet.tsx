"use client";

/**
 * LibraryEditSheet — the design-library edit flow as a bottom sheet
 * (replacing the old centered modal), exposing EVERY writable field on
 * garment_library:
 *
 *   • labels / descriptions / famous_for / styling_notes (en)
 *   • category, celebrity_name, reference_url, occasions
 *   • ideal_body_types — previously API-only, now a chip multi-select fed
 *     from the storefront's live facet values (plus the row's own values
 *     and a free-text add for brand-new ones)
 *   • status, priority_order
 *   • hero / front / back / side image uploads
 *
 * "Edit selections" opens the order-page-style LibrarySelectionSheet
 * (stacked on top) for the design's component/add-on rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  adminUpdateLibrary,
  adminUploadLibraryImage,
  type LibraryAdmin,
  type LibraryItem,
  type LibraryUpdate,
} from "@/lib/admin-api";
import { libraryApi } from "@/lib/api";

import { LibrarySelectionSheet } from "./LibrarySelectionSheet";

// ─── Helpers ───────────────────────────────────────────────────────────────

function en(d: Record<string, string> | null | undefined): string {
  return d?.en ?? "";
}

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

// The storefront-facing vocabulary (lowercase — what the seeded designs and
// the browse-grid chips actually carry) merged with the curation terms the
// old dropdown offered. The row's current value is always appended so
// touching other fields can never accidentally blank an unlisted category.
const BASE_CATEGORY_OPTIONS = [
  "celebrity",
  "classic",
  "Classic",
  "Designer",
  "Bridal",
  "Festive",
  "Back Design",
  "Sleeve Style",
  "Neckline",
  "Closure",
];

// ─── Component ─────────────────────────────────────────────────────────────

export function LibraryEditSheet({
  item,
  onClose,
  onSaved,
}: {
  item: LibraryAdmin;
  onClose: () => void;
  onSaved: (updated: LibraryAdmin) => void;
}) {
  // ── Local editable copies ────────────────────────────────────────────────
  const [labelEn, setLabelEn] = useState(en(item.labels));
  const [descEn, setDescEn] = useState(en(item.descriptions));
  const [category, setCategory] = useState(item.category ?? "");
  const [celebrity, setCelebrity] = useState(item.celebrity_name ?? "");
  const [famousForEn, setFamousForEn] = useState(en(item.famous_for));
  const [referenceUrl, setReferenceUrl] = useState(item.reference_url ?? "");
  const [occasions, setOccasions] = useState((item.occasions ?? []).join(", "));
  const [bodyTypes, setBodyTypes] = useState<string[]>(item.ideal_body_types ?? []);
  const [stylingEn, setStylingEn] = useState(en(item.styling_notes));
  const [status, setStatus] = useState(item.status ?? "");
  const [priority, setPriority] = useState(
    item.priority_order != null ? String(item.priority_order) : "",
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadField, setUploadField] = useState<
    "hero" | "front" | "back" | "side"
  >("hero");

  // Live preview of image URLs — updated after each upload.
  const [heroUrl, setHeroUrl] = useState(item.hero_image_url);
  const [frontUrl, setFrontUrl] = useState(item.front_image_url);
  const [backUrl, setBackUrl] = useState(item.back_image_url);
  const [sideUrl, setSideUrl] = useState(item.side_image_url);

  // ── Style selections (stacked sheet) ─────────────────────────────────────
  const [selectionsOpen, setSelectionsOpen] = useState(false);
  const [itemsCount, setItemsCount] = useState<number | null>(null);

  // ── Ideal-body-type vocabulary: the storefront's live facet values ──────
  // (public endpoint), unioned with the row's own tags so nothing ever
  // disappears from the cloud.
  const [bodyTypeVocab, setBodyTypeVocab] = useState<string[]>([]);
  const [customBodyType, setCustomBodyType] = useState("");
  useEffect(() => {
    let cancelled = false;
    libraryApi
      .getLibraryFacets()
      .then((f) => {
        if (!cancelled) setBodyTypeVocab(f.body_types.map((b) => b.value));
      })
      .catch(() => {}); // non-fatal — the row's own values still render
    return () => {
      cancelled = true;
    };
  }, []);
  const bodyTypeChips = Array.from(
    new Set([...bodyTypeVocab, ...(item.ideal_body_types ?? []), ...bodyTypes]),
  );

  // ── Category options: base vocabulary + the row's current value ──────────
  const categoryOptions = Array.from(
    new Set([...BASE_CATEGORY_OPTIONS, ...(item.category ? [item.category] : [])]),
  ).map((v) => ({ value: v, label: v }));

  // ── Save (sparse PATCH — only changed fields go over the wire) ───────────
  function buildPatch(): LibraryUpdate {
    const patch: LibraryUpdate = {};
    const newLabel = { en: labelEn };
    if (labelEn !== en(item.labels)) patch.labels = labelEn ? newLabel : null;

    const newDesc = { en: descEn };
    if (descEn !== en(item.descriptions))
      patch.descriptions = descEn ? newDesc : null;

    if (category !== (item.category ?? "")) patch.category = category || null;
    if (celebrity !== (item.celebrity_name ?? ""))
      patch.celebrity_name = celebrity || null;

    const newFf = { en: famousForEn };
    if (famousForEn !== en(item.famous_for))
      patch.famous_for = famousForEn ? newFf : null;

    if (referenceUrl !== (item.reference_url ?? ""))
      patch.reference_url = referenceUrl || null;

    const occArr = occasions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (occArr.join(",") !== (item.occasions ?? []).join(","))
      patch.occasions = occArr.length > 0 ? occArr : null;

    const sorted = (a: string[]) => [...a].sort().join("\u0000");
    if (sorted(bodyTypes) !== sorted(item.ideal_body_types ?? []))
      patch.ideal_body_types = bodyTypes.length > 0 ? bodyTypes : null;

    const newStyling = { en: stylingEn };
    if (stylingEn !== en(item.styling_notes))
      patch.styling_notes = stylingEn ? newStyling : null;

    if (status !== (item.status ?? "")) patch.status = status || null;

    const newPrio = priority === "" ? null : Number(priority);
    if (newPrio !== item.priority_order) patch.priority_order = newPrio;

    return patch;
  }

  async function handleSave() {
    setErr(null);
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = await adminUpdateLibrary(item.id, patch);
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(file: File) {
    setErr(null);
    setUploading(uploadField);
    try {
      const updated = await adminUploadLibraryImage(item.id, uploadField, file);
      setHeroUrl(updated.hero_image_url);
      setFrontUrl(updated.front_image_url);
      setBackUrl(updated.back_image_url);
      setSideUrl(updated.side_image_url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const imageBoxes: {
    field: "hero" | "front" | "back" | "side";
    url: string | null;
    label: string;
  }[] = [
    { field: "hero", url: heroUrl, label: "Hero" },
    { field: "front", url: frontUrl, label: "Front" },
    { field: "back", url: backUrl, label: "Back" },
    { field: "side", url: sideUrl, label: "Side" },
  ];

  return (
    <>
      <BottomSheet
        open
        title={en(item.labels) || "Edit design"}
        onClose={onClose}
        className="max-w-column md:max-w-2xl"
      >
        <div className="space-y-5 pb-2">
          {err && (
            <div className="rounded-card border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700">
              {err}
            </div>
          )}

          {/* ─── Images ──────────────────────────────────────────────────── */}
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink-navy">Images</p>
            <div className="grid grid-cols-4 gap-2">
              {imageBoxes.map((box) => (
                <button
                  key={box.field}
                  type="button"
                  onClick={() => setUploadField(box.field)}
                  className={`relative aspect-[4/5] overflow-hidden rounded-card border text-left transition ${
                    uploadField === box.field
                      ? "border-ink-navy ring-2 ring-ink-navy/20"
                      : "border-hairline hover:border-ink-navy"
                  }`}
                >
                  {box.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={box.url}
                      alt={box.label}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] text-muted">
                      {box.label}
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-ink-navy/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-white">
                    {box.label}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading !== null}
                className="rounded-card border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[12px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:opacity-50"
              >
                {uploading === uploadField
                  ? "Uploading…"
                  : `Upload ${uploadField} image`}
              </button>
              <span className="text-[11px] text-muted">JPG / PNG / WebP</span>
            </div>
          </div>

          {/* ─── Fields ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (EN)">
              <input
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                placeholder="Design name"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>
            <Field label="Category">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              >
                <option value="">—</option>
                {categoryOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Celebrity name">
              <input
                value={celebrity}
                onChange={(e) => setCelebrity(e.target.value)}
                placeholder="e.g. Deepika Padukone"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>
            <Field label="Famous for (EN)">
              <input
                value={famousForEn}
                onChange={(e) => setFamousForEn(e.target.value)}
                placeholder="e.g. Cannes appearance"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>

            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority order">
              <input
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="e.g. 1"
                type="number"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>

            <Field label="Reference URL">
              <input
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>
            <Field
              label="Occasions (comma separated)"
              hint="Shown as the card tags and the Occasions filter"
            >
              <input
                value={occasions}
                onChange={(e) => setOccasions(e.target.value)}
                placeholder="Sangeet, Bridal, Festive"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
              />
            </Field>
          </div>

          {/* ─── Ideal body types — chip multi-select ────────────────────── */}
          <div>
            <p className="mb-1 text-[12px] font-medium text-ink-navy">
              Ideal body types
            </p>
            <p className="mb-2 text-[11px] text-muted">
              Powers the &ldquo;Body Types&rdquo; filter and the
              &ldquo;Ideal for&rdquo; tags on the design page.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {bodyTypeChips.map((bt) => {
                const active = bodyTypes.includes(bt);
                return (
                  <button
                    key={bt}
                    type="button"
                    onClick={() =>
                      setBodyTypes((prev) =>
                        prev.includes(bt)
                          ? prev.filter((v) => v !== bt)
                          : [...prev, bt],
                      )
                    }
                    className={`rounded-pill border px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? "border-ink-navy bg-ink-navy text-chalk-white"
                        : "border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
                    }`}
                  >
                    {bt}
                  </button>
                );
              })}
              {bodyTypeChips.length === 0 && (
                <span className="text-[11px] text-muted">
                  No body types available yet.
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={customBodyType}
                onChange={(e) => setCustomBodyType(e.target.value)}
                placeholder="Add a custom type…"
                className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[12px] outline-none focus:border-ink-navy"
              />
              <button
                type="button"
                disabled={!customBodyType.trim()}
                onClick={() => {
                  const v = customBodyType.trim();
                  if (!v) return;
                  setBodyTypes((prev) => (prev.includes(v) ? prev : [...prev, v]));
                  setCustomBodyType("");
                }}
                className="shrink-0 rounded-card border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[12px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          <Field label="Description (EN)">
            <textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              rows={3}
              placeholder="Short design description"
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
            />
          </Field>

          <Field label="Styling notes (EN)">
            <textarea
              value={stylingEn}
              onChange={(e) => setStylingEn(e.target.value)}
              rows={3}
              placeholder="Styling tips, fabric notes, etc."
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
            />
          </Field>

          {/* ─── Style selections — the order-page sheet, stacked ─────────── */}
          <div className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-mist-navy/20 px-4 py-3">
            <div>
              <p className="text-[13px] font-semibold text-ink-navy">
                Selections
              </p>
              <p className="text-[11px] text-muted">
                {itemsCount != null
                  ? `${itemsCount} item${itemsCount === 1 ? "" : "s"} in this design`
                  : "Components & add-ons the design pre-selects"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectionsOpen(true)}
              className="shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-3.5 py-1.5 text-[12px] font-semibold text-ink-navy transition hover:bg-mist-navy"
            >
              Edit selections
            </button>
          </div>
        </div>

        {/* ─── Footer ─────────────────────────────────────────────────────── */}
        <div className="sticky bottom-0 z-20 -mx-4 -mb-6 mt-4 flex items-center justify-end gap-2 border-t border-hairline bg-chalk-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_16px_-8px_rgba(23,42,72,0.25)]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-card px-4 py-2 text-[13px] font-medium text-muted transition hover:text-ink-navy"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-card bg-ink-navy px-5 py-2 text-[13px] font-semibold text-chalk-white transition hover:bg-ink-navy/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </BottomSheet>

      {/* Stacked on top of the edit sheet — same pattern as the order page's
          detail → Edit selections flow. */}
      {selectionsOpen && (
        <LibrarySelectionSheet
          open
          libraryId={item.id}
          garmentId={item.garment_id}
          garmentLabel={en(item.labels) || "Blouse"}
          basePrice={null}
          onClose={() => setSelectionsOpen(false)}
          onSaved={(rows: LibraryItem[]) => setItemsCount(rows.length)}
        />
      )}
    </>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-ink-navy">
        {label}
      </span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
