"use client";

/**
 * Admin Design Library — grid of every design; tapping one opens the
 * LibraryEditSheet (bottom sheet, every writable field) which in turn opens
 * the order-page-style LibrarySelectionSheet for the design's items.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminListLibraries, type LibraryAdmin } from "@/lib/admin-api";

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
            {items.length} designs · tap a card to edit
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

function LibraryCard({ item, onEdit }: { item: LibraryAdmin; onEdit: () => void }) {
  const title = en(item.labels) || "Untitled";
  const occasions = item.occasions ?? [];

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex flex-col overflow-hidden rounded-card border border-hairline bg-chalk-white text-left transition-all hover:border-ink-navy hover:shadow-card"
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
