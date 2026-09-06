"use client";

/**
 * PromoPickerSheet — bottom-sheet selectors for every slug/UUID field on
 * the promo form.
 *
 *   TieredPickerSheet  drill-down sheet over a PickerNode tree (garment →
 *                     component → variation → type, addon → variation, …):
 *                     breadcrumbs, per-level search, multi-select leaves,
 *                     working-copy selection committed on Done.
 *   PickerField       the form control: chip box of resolved labels (raw
 *                     slug + warning tint for stale keys), per-chip remove,
 *                     tap to open the sheet.
 *
 * All tree shaping/scoping/filtering lives in lib/promo-pickers (pure,
 * unit-tested); this file is presentation only.
 */

import { useEffect, useMemo, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { filterPickerNodes, selectedLabelMap, type PickerNode } from "@/lib/promo-pickers";

// ── TieredPickerSheet ────────────────────────────────────────────────────────

export function TieredPickerSheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  nodes: PickerNode[];
  /** Committed selection — the sheet works on a copy until Done. */
  selected: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
}) {
  const { open, onClose, title, nodes, selected, onChange, loading } = props;

  // Drill path holds folder KEYS; the level is re-derived from the fresh
  // nodes prop on every render, so a stale path (options refetched, folder
  // gone) simply falls back to the deepest still-valid level.
  const [path, setPath] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setPath([]);
      setQuery("");
      setWorking(selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { levelNodes, crumbs } = useMemo(() => {
    let cur = nodes;
    const trail: { key: string; label: string }[] = [];
    for (const key of path) {
      const next = cur.find((n) => n.key === key && (n.children?.length ?? 0) > 0);
      if (!next) break;
      trail.push({ key: next.key, label: next.label });
      cur = next.children ?? [];
    }
    return { levelNodes: cur, crumbs: trail };
  }, [nodes, path]);

  const effPath = crumbs.map((c) => c.key);

  const shown = useMemo(
    () => (query.trim() ? filterPickerNodes(levelNodes, query) : levelNodes),
    [levelNodes, query],
  );

  // Folders first so the drill path reads top-to-bottom; leaves after.
  const ordered = useMemo(() => {
    const folders = shown.filter((n) => (n.children?.length ?? 0) > 0);
    const leaves = shown.filter((n) => (n.children?.length ?? 0) === 0);
    return [...folders, ...leaves];
  }, [shown]);

  function toggle(key: string) {
    setWorking((w) => (w.includes(key) ? w.filter((k) => k !== key) : [...w, key]));
  }

  function commit() {
    onChange(working);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-eyebrow text-ink-navy">
              {working.length} selected
            </p>
            {working.length > 0 && (
              <button
                type="button"
                onClick={() => setWorking([])}
                className="text-[11px] text-muted underline underline-offset-2"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="tap rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="tap rounded-pill bg-ink-navy px-5 py-2 text-caption font-medium text-chalk-white"
            >
              Done
            </button>
          </div>
        </div>
      }
    >
      {/* Breadcrumbs + search stay pinned so deep levels stay navigable */}
      <div className="sticky -top-4 z-10 -mx-4 space-y-2 bg-chalk-white px-4 pb-2 pt-1 md:-mx-5 md:px-5">
        <nav className="flex flex-wrap items-center gap-1 font-mono text-[11px] uppercase tracking-wide">
          <button
            type="button"
            onClick={() => setPath([])}
            className={`rounded-pill px-2 py-0.5 ${
              effPath.length === 0 ? "bg-ink-navy text-chalk-white" : "text-muted hover:bg-mist-navy"
            }`}
          >
            All
          </button>
          {crumbs.map((c, i) => (
            <span key={c.key} className="flex items-center gap-1">
              <span className="text-muted">›</span>
              <button
                type="button"
                onClick={() => setPath(effPath.slice(0, i + 1))}
                className={`rounded-pill px-2 py-0.5 ${
                  i === effPath.length - 1
                    ? "bg-ink-navy text-chalk-white"
                    : "text-muted hover:bg-mist-navy"
                }`}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={effPath.length === 0 ? "Search all…" : "Search this level…"}
          className="w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text"
        />
      </div>

      <div className="pb-2">
        {loading ? (
          <div className="flex h-32 items-center justify-center text-caption text-muted">
            Loading options…
          </div>
        ) : ordered.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-caption text-muted">
            {query.trim() ? `No matches for “${query.trim()}”.` : "Nothing here yet."}
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {ordered.map((n) => {
              const isFolder = (n.children?.length ?? 0) > 0;
              // A selectable folder (requirement sheets) is BOTH drillable
              // and pickable: the check circle is its own tap target, the
              // row drills. Row is a div role=button so the circle can be
              // a real button inside it (nested <button> is invalid HTML).
              const selectFolder = isFolder && n.selectable;
              const checked = working.includes(n.key);
              const activate = () => (isFolder ? setPath([...effPath, n.key]) : toggle(n.key));
              const checkCircle = (size = "h-6 w-6") => (
                <span
                  className={`flex ${size} shrink-0 items-center justify-center rounded-full border text-[12px] font-bold ${
                    checked
                      ? "border-ink-navy bg-ink-navy text-chalk-white"
                      : "border-hairline-strong text-transparent"
                  }`}
                >
                  ✓
                </span>
              );
              return (
                <li key={n.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={activate}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        activate();
                      }
                    }}
                    className="flex w-full cursor-pointer items-center gap-3 px-1 py-3 text-left transition hover:bg-mist-navy/50"
                  >
                    {isFolder ? (
                      selectFolder ? (
                        <button
                          type="button"
                          aria-label={`${checked ? "Unselect" : "Select"} ${n.label}`}
                          aria-pressed={checked}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(n.key);
                          }}
                          className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent-text"
                        >
                          {checkCircle()}
                        </button>
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill border border-hairline-strong font-mono text-[11px] text-ink-navy">
                          +
                        </span>
                      )
                    ) : (
                      checkCircle()
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-data font-medium text-ink">
                        {n.label}
                      </span>
                      {(n.sublabel || (isFolder && n.children!.length)) && (
                        <span className="block truncate text-[11px] text-muted">
                          {n.sublabel ?? `${n.children!.length} option${n.children!.length === 1 ? "" : "s"}`}
                        </span>
                      )}
                    </span>
                    {isFolder && <span className="shrink-0 text-lg text-muted">›</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

// ── PickerField ──────────────────────────────────────────────────────────────

export function PickerField(props: {
  label: string;
  hint?: string;
  /** Hide the visible label (card header already carries it) — the
   * accessible name on the box is kept. */
  hideLabel?: boolean;
  nodes: PickerNode[];
  /** Committed selection — raw slugs/ids, CSV-joined by the caller. */
  value: string[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  placeholder?: string;
}) {
  const { label, hint, nodes, value, onChange, loading } = props;
  const [open, setOpen] = useState(false);

  const labels = useMemo(() => selectedLabelMap(nodes), [nodes]);
  const known = value.filter((k) => labels.has(k));
  const stale = value.filter((k) => !labels.has(k));

  const boxEmpty = known.length === 0 && stale.length === 0;

  return (
    <div>
      {!props.hideLabel && (
        <span className="mb-1.5 block font-mono text-eyebrow text-ink-navy">{label}</span>
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Select ${label.toLowerCase()}`}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="min-h-[42px] w-full cursor-pointer rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none transition focus-within:border-accent-text hover:border-ink-navy/40"
      >
        {boxEmpty ? (
          <span className="text-muted">{loading ? "Loading options…" : (props.placeholder ?? "Tap to select")}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {known.map((k) => (
              <Chip key={k} text={labels.get(k) ?? k} onRemove={() => onChange(value.filter((x) => x !== k))} />
            ))}
            {stale.map((k) => (
              <Chip key={k} text={k} stale onRemove={() => onChange(value.filter((x) => x !== k))} />
            ))}
          </div>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}

      <TieredPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        nodes={nodes}
        selected={value}
        onChange={onChange}
        loading={loading}
      />
    </div>
  );
}

function Chip(props: { text: string; stale?: boolean; onRemove: () => void }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-pill border px-2.5 py-0.5 text-caption ${
        props.stale
          ? "border-amber-300 bg-amber-50 font-mono text-amber-800"
          : "border-hairline-strong bg-mist-navy/60 text-ink"
      }`}
    >
      <span className="truncate">{props.text}</span>
      <button
        type="button"
        aria-label={`Remove ${props.text}`}
        onClick={(e) => {
          e.stopPropagation();
          props.onRemove();
        }}
        className="shrink-0 rounded-full px-1 text-[13px] leading-none text-muted hover:text-ink"
      >
        ×
      </button>
    </span>
  );
}
