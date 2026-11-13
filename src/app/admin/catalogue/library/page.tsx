"use client";

/**
 * Admin Design Library — grid of every design; tapping one opens the
 * LibraryEditSheet (bottom sheet, every writable field) which in turn opens
 * the order-page-style LibrarySelectionSheet for the design's items.
 *
 * Deletion: a trash button on each card deletes that design; "Select" in the
 * header enters multi-select mode where cards toggle selection and a bulk
 * bar deletes everything selected in one request.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminBulkDeleteLibraries,
  adminDeleteLibrary,
  adminListLibraries,
  type LibraryAdmin,
} from "@/lib/admin-api";

import { LibraryEditSheet } from "./LibraryEditSheet";

// ─── Helpers ───────────────────────────────────────────────────────────────

function en(d: Record<string, string> | null | undefined): string {
  return d?.en ?? "";
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminLibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<LibraryAdmin | null>(null);

  // ── Delete + multi-select ────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // Drop selections that no longer exist (deleted, filtered out by status).
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(items.map((it) => it.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  function handleSaved(updated: LibraryAdmin) {
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
    setEditing(null);
  }

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      if (filtered.every((it) => prev.has(it.id))) {
        const next = new Set(prev);
        filtered.forEach((it) => next.delete(it.id));
        return next;
      }
      return new Set([...prev, ...filtered.map((it) => it.id)]);
    });
  }

  async function handleDelete(item: LibraryAdmin) {
    const title = en(item.labels) || "Untitled";
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    setDeletingId(item.id);
    setError(null);
    try {
      await adminDeleteLibrary(item.id);
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} design(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    setError(null);
    try {
      await adminBulkDeleteLibraries(ids);
      const gone = new Set(ids);
      setItems((prev) => prev.filter((it) => !gone.has(it.id)));
      setSelected(new Set());
      setSelectMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk delete failed");
    } finally {
      setBulkBusy(false);
    }
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
            {selectMode
              ? `${selected.size} of ${filtered.length} selected · tap cards to toggle`
              : `${items.length} designs · tap a card to edit`}
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
          <button
            type="button"
            onClick={toggleSelectMode}
            className={`rounded-card border px-3 py-2 text-[13px] font-medium transition ${
              selectMode
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:border-ink-navy"
            }`}
          >
            {selectMode ? "Cancel" : "Select"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Bulk action bar */}
      {selectMode && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-ink-navy/30 bg-mist-navy/40 px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-navy">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label="Select all"
              className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
            />
            Select all
          </label>
          <span className="text-xs font-semibold text-ink-navy">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={bulkBusy || selected.size === 0}
            className="rounded-card border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
          >
            {bulkBusy ? "Deleting…" : `Delete selected`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={bulkBusy || selected.size === 0}
            className="text-xs font-medium text-muted underline hover:text-ink-navy disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-muted">No designs found.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((it) => (
            <LibraryCard
              key={it.id}
              item={it}
              selectMode={selectMode}
              selected={selected.has(it.id)}
              deleting={deletingId === it.id}
              onEdit={() => setEditing(it)}
              onToggleSelect={() => toggleSelect(it.id)}
              onDelete={() => void handleDelete(it)}
            />
          ))}
        </div>
      )}

      {editing && (
        <LibraryEditSheet
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

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

function LibraryCard({
  item,
  selectMode,
  selected,
  deleting,
  onEdit,
  onToggleSelect,
  onDelete,
}: {
  item: LibraryAdmin;
  selectMode: boolean;
  selected: boolean;
  deleting: boolean;
  onEdit: () => void;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const title = en(item.labels) || "Untitled";
  const occasions = item.occasions ?? [];

  // A plain div wrapper (not <button>) so the delete/select controls can be
  // real buttons nested inside without invalid HTML.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={selectMode ? onToggleSelect : onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectMode) onToggleSelect();
          else onEdit();
        }
      }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-card border bg-chalk-white text-left transition-all hover:border-ink-navy hover:shadow-card ${
        selected ? "border-ink-navy ring-2 ring-ink-navy/30" : "border-hairline"
      } ${deleting ? "pointer-events-none opacity-50" : ""}`}
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
        {/* Selection checkbox (multi-select mode) */}
        {selectMode && (
          <span
            className="absolute left-2 top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border bg-chalk-white shadow-sm"
            aria-hidden="true"
          >
            {selected && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5 text-ink-navy"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            )}
          </span>
        )}
        {/* Per-card delete (hidden while multi-selecting) */}
        {!selectMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={deleting}
            aria-label={`Delete ${title}`}
            title="Delete"
            className="absolute right-2 top-2 rounded-full border border-red-200 bg-chalk-white/90 p-1.5 text-red-600 opacity-0 shadow-sm backdrop-blur-sm transition-all hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
          >
            <TrashIcon />
          </button>
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
    </div>
  );
}
