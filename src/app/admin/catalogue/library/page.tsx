"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminListLibraries,
  adminUpdateLibrary,
  adminUploadLibraryImage,
  type LibraryAdmin,
  type LibraryUpdate,
} from "@/lib/admin-api";
import {
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "../_shared/catalogue-helpers";
import { ItemsEditor } from "./ItemsEditor";

// ─── Helpers ───────────────────────────────────────────────────────────────

function en(d: Record<string, string> | null | undefined): string {
  return d?.en ?? "";
}

function occList(arr: string[] | null | undefined): string {
  return (arr ?? []).join(", ");
}

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

const CATEGORY_OPTIONS = [
  { value: "", label: "—" },
  { value: "Classic", label: "Classic" },
  { value: "Designer", label: "Designer" },
  { value: "Bridal", label: "Bridal" },
  { value: "Festive", label: "Festive" },
  { value: "Back Design", label: "Back Design" },
  { value: "Sleeve Style", label: "Sleeve Style" },
  { value: "Neckline", label: "Neckline" },
  { value: "Closure", label: "Closure" },
];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminLibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<LibraryAdmin | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListLibraries(statusFilter || undefined);
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Secondary sidebar
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "Catalogue",
              active: false,
              onClick: () => router.push("/admin/catalogue"),
            },
            {
              label: "Library",
              active: true,
              onClick: () => router.push("/admin/catalogue/library"),
            },
            {
              label: "Measurements",
              active: false,
              onClick: () => router.push("/admin/measurements"),
            },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(new CustomEvent("admin-sidebar-update", { detail: null }));
    };
  }, [router]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((it) => {
      const name = en(it.labels).toLowerCase();
      const cat = (it.category ?? "").toLowerCase();
      const celebs = en(it.famous_for).toLowerCase();
      return name.includes(q) || cat.includes(q) || celebs.includes(q);
    });
  }, [items, search]);

  function handleSaved(updated: LibraryAdmin) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    setEditing(null);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold text-ink-navy">
            Design Library
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {items.length} designs · edit fields, status &amp; images
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, category, celebrity…"
            className="w-64 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] outline-none focus:border-ink-navy"
          >
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted">No designs found.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((it) => (
            <LibraryCard key={it.id} item={it} onEdit={() => setEditing(it)} />
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          key={editing.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function LibraryCard({ item, onEdit }: { item: LibraryAdmin; onEdit: () => void }) {
  const title = en(item.labels) || "Untitled";
  const occasions = item.occasions ?? [];

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left transition-all hover:border-navy-interactive hover:shadow-card"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-mist-navy">
        {item.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.hero_image_url}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-muted">
            No image
          </div>
        )}
        {/* Status pill */}
        {item.status && item.status !== "published" && (
          <span className="absolute left-2 top-2 rounded-pill bg-ink-navy/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-chalk-white backdrop-blur-sm">
            {item.status}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          {item.category ? (
            <span className="rounded-pill bg-warm-sand px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-navy">
              {item.category}
            </span>
          ) : (
            <span />
          )}
          <span className="font-mono text-[10px] text-muted">
            #{item.priority_order ?? "—"}
          </span>
        </div>
        <p className="line-clamp-1 text-[13px] font-medium text-ink-navy">{title}</p>
        {occasions.length > 0 && (
          <p className="line-clamp-1 text-[11px] text-muted">
            {occasions.join(" · ")}
          </p>
        )}
      </div>
    </button>
  );
}

// ─── Edit Modal ─────────────────────────────────────────────────────────────

function EditModal({
  item,
  onClose,
  onSaved,
}: {
  item: LibraryAdmin;
  onClose: () => void;
  onSaved: (updated: LibraryAdmin) => void;
}) {
  // Local editable copies
  const [labelEn, setLabelEn] = useState(en(item.labels));
  const [descEn, setDescEn] = useState(en(item.descriptions));
  const [category, setCategory] = useState(item.category ?? "");
  const [celebrity, setCelebrity] = useState(item.celebrity_name ?? "");
  const [famousForEn, setFamousForEn] = useState(en(item.famous_for));
  const [referenceUrl, setReferenceUrl] = useState(item.reference_url ?? "");
  const [occasions, setOccasions] = useState(occList(item.occasions));
  const [stylingEn, setStylingEn] = useState(en(item.styling_notes));
  const [status, setStatus] = useState(item.status ?? "");
  const [priority, setPriority] = useState(
    item.priority_order != null ? String(item.priority_order) : "",
  );

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadField, setUploadField] = useState<"hero" | "front" | "back" | "side">("hero");

  // Live preview of image URLs — updated after each upload
  const [heroUrl, setHeroUrl] = useState(item.hero_image_url);
  const [frontUrl, setFrontUrl] = useState(item.front_image_url);
  const [backUrl, setBackUrl] = useState(item.back_image_url);
  const [sideUrl, setSideUrl] = useState(item.side_image_url);

  function buildPatch(): LibraryUpdate {
    const patch: LibraryUpdate = {};
    const orig = item;

    const newLabel = { en: labelEn };
    if (labelEn !== en(orig.labels)) patch.labels = labelEn ? newLabel : null;

    const newDesc = { en: descEn };
    if (descEn !== en(orig.descriptions)) patch.descriptions = descEn ? newDesc : null;

    if (category !== (orig.category ?? "")) patch.category = category || null;
    if (celebrity !== (orig.celebrity_name ?? "")) patch.celebrity_name = celebrity || null;

    const newFf = { en: famousForEn };
    if (famousForEn !== en(orig.famous_for)) patch.famous_for = famousForEn ? newFf : null;

    if (referenceUrl !== (orig.reference_url ?? "")) patch.reference_url = referenceUrl || null;

    const occArr = occasions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const origOcc = orig.occasions ?? [];
    if (occArr.join(",") !== origOcc.join(","))
      patch.occasions = occArr.length > 0 ? occArr : null;

    const newStyling = { en: stylingEn };
    if (stylingEn !== en(orig.styling_notes)) patch.styling_notes = stylingEn ? newStyling : null;

    if (status !== (orig.status ?? "")) patch.status = status || null;

    const newPrio = priority === "" ? null : Number(priority);
    if (newPrio !== orig.priority_order) patch.priority_order = newPrio;

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

  const imageBoxes: { field: "hero" | "front" | "back" | "side"; url: string | null; label: string }[] = [
    { field: "hero", url: heroUrl, label: "Hero" },
    { field: "front", url: frontUrl, label: "Front" },
    { field: "back", url: backUrl, label: "Back" },
    { field: "side", url: sideUrl, label: "Side" },
  ];

  return (
    <Modal open onClose={onClose} title={en(item.labels) || "Edit Design"} maxWidth="max-w-3xl">
      <div className="space-y-5">
        {err && (
          <div className="rounded-card border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700">
            {err}
          </div>
        )}

        {/* Image gallery */}
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
                    : "border-hairline hover:border-navy-interactive"
                }`}
              >
                {box.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={box.url} alt={box.label} className="h-full w-full object-cover" />
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
              {uploading === uploadField ? "Uploading…" : `Upload ${uploadField} image`}
            </button>
            <span className="text-[11px] text-muted">JPG / PNG / WebP</span>
          </div>
        </div>

        {/* Text fields */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name (EN)">
            <TextInput value={labelEn} onChange={setLabelEn} placeholder="Design name" />
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
            />
          </Field>

          <Field label="Celebrity name">
            <TextInput value={celebrity} onChange={setCelebrity} placeholder="e.g. Deepika Padukone" />
          </Field>
          <Field label="Famous for (EN)">
            <TextInput value={famousForEn} onChange={setFamousForEn} placeholder="e.g. Cannes appearance" />
          </Field>

          <Field label="Status">
            <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Priority order">
            <TextInput
              value={priority}
              onChange={setPriority}
              placeholder="e.g. 1"
              type="number"
            />
          </Field>

          <Field label="Reference URL">
            <TextInput value={referenceUrl} onChange={setReferenceUrl} placeholder="https://…" />
          </Field>
          <Field label="Occasions (comma separated)">
            <TextInput
              value={occasions}
              onChange={setOccasions}
              placeholder="Sangeet, Bridal, Festive"
            />
          </Field>
        </div>

        <Field label="Description (EN)">
          <TextArea value={descEn} onChange={setDescEn} rows={3} placeholder="Short design description" />
        </Field>

        <Field label="Styling notes (EN)">
          <TextArea value={stylingEn} onChange={setStylingEn} rows={3} placeholder="Styling tips, fabric notes, etc." />
        </Field>

        {/* ─── Style items: variations + add-ons ────────────────────────── */}
        <div className="border-t border-hairline pt-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-navy">
            Style items
          </p>
          <ItemsEditor libraryId={item.id} />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-card px-4 py-2 text-[13px] font-medium text-muted transition hover:text-ink-navy"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-card bg-ink-navy px-5 py-2 text-[13px] font-semibold text-chalk-white transition hover:bg-navy-interactive disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
