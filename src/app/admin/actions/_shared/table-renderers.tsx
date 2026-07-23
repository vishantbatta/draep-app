"use client";

import { useMemo, useState, useRef, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════════

/** A lookup map of entity ID → human-readable label */
export type RelationMap = Record<string, { label: string; detail: Record<string, unknown> }>;

/** Configuration describing a foreign-key column */
export interface RelationConfig {
  /** Column name in the table data, e.g. "garment_id" */
  column: string;
  /** Human label for the relation, e.g. "Garment" */
  entityLabel: string;
  /** The lookup map */
  map: RelationMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Language pills for Record<string,string> columns
// ═══════════════════════════════════════════════════════════════════════════════

const LANG_FLAGS: Record<string, string> = {
  en: "EN",
  hi: "HI",
  ta: "TA",
  te: "TE",
  kn: "KN",
  ml: "ML",
  bn: "BN",
  mr: "MR",
  gu: "GU",
  pa: "PA",
};

function LangDictCell({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const data = useMemo(() => {
    if (!value || typeof value !== "object") return null;
    const dict = value as Record<string, string>;
    const entries = Object.entries(dict).filter(([, v]) => v?.trim());
    if (entries.length === 0) return null;
    return entries;
  }, [value]);

  if (!data) return <span className="text-muted/50 italic">NULL</span>;

  const en = data.find(([k]) => k === "en");
  const primary = en?.[1] ?? data[0][1];
  const extraCount = data.length - 1;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="max-w-[200px] truncate text-ink">{primary}</span>
        {extraCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-pill bg-mist-navy px-1.5 py-0.5 font-mono text-[10px] text-ink-navy">
            +{extraCount}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {data.map(([lang, text]) => {
        const flag = LANG_FLAGS[lang] ?? lang.toUpperCase();
        const isEn = lang === "en";
        return (
          <span
            key={lang}
            className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] ${
              isEn ? "bg-accent-surface text-ink-navy" : "bg-mist-navy text-ink-navy/70"
            }`}
          >
            <span className="font-mono text-[9px] font-semibold opacity-60">{flag}</span>
            <span className="max-w-[160px] truncate">{text}</span>
          </span>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tag list for string[] columns
// ═══════════════════════════════════════════════════════════════════════════════

function ArrayTagsCell({
  value,
  variant = "default",
}: {
  value: unknown;
  variant?: "default" | "positive" | "negative" | "asset";
}) {
  const items = useMemo(() => {
    if (!value) return null;
    if (Array.isArray(value)) return value as string[];
    return null;
  }, [value]);

  if (!items || items.length === 0) return <span className="text-muted/50 italic">NULL</span>;

  const styles =
    variant === "positive"
      ? "bg-green-50 text-green-700 border-green-200"
      : variant === "negative"
        ? "bg-red-50 text-red-700 border-red-200"
        : variant === "asset"
          ? "bg-blue-50 text-blue-700 border-blue-200"
          : "bg-mist-navy text-ink-navy/70 border-hairline";

  if (variant === "asset") {
    // Show image thumbnails for asset URLs
    return (
      <div className="flex items-center gap-1">
        {items.slice(0, 3).map((url, i) => (
          <div key={i} className="relative h-8 w-8 shrink-0 overflow-hidden rounded-card border border-hairline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Asset ${i + 1}`}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                const parent = (e.target as HTMLImageElement).parentElement;
                if (parent) parent.classList.add("flex", "items-center", "justify-center", "bg-mist-navy");
                const span = document.createElement("span");
                span.className = "text-[8px] text-muted";
                span.textContent = "?";
                parent?.appendChild(span);
              }}
            />
          </div>
        ))}
        {items.length > 3 && (
          <span className="inline-flex items-center rounded-pill bg-mist-navy px-1.5 py-0.5 font-mono text-[10px] text-ink-navy">
            +{items.length - 3}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item, i) => (
        <span
          key={i}
          className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[11px] ${styles}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Relation cell with hover card
// ═══════════════════════════════════════════════════════════════════════════════

function RelationCell({
  id,
  config,
}: {
  id: string;
  config: RelationConfig;
}) {
  const [showCard, setShowCard] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cellRef = useRef<HTMLSpanElement>(null);

  const entity = config.map[id];

  function handleEnter() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowCard(true), 350);
  }

  function handleLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setShowCard(false);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span
      ref={cellRef}
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {entity ? (
        <span className="inline-flex cursor-help items-center gap-1 rounded-pill bg-accent-surface px-2 py-0.5 text-[11px] font-medium text-ink-navy underline decoration-dotted underline-offset-2">
          <svg className="h-3 w-3 shrink-0 opacity-50" viewBox="0 0 12 12" fill="none">
            <path d="M3 7l2 2 4-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" stroke="currentColor" strokeWidth="1" opacity="0.4" />
          </svg>
          <span className="max-w-[180px] truncate">{entity.label}</span>
        </span>
      ) : (
        <span className="font-mono text-[11px] text-muted">{id ? id.slice(0, 8) + "..." : "—"}</span>
      )}

      {showCard && entity && (
        <RelationHoverCard entity={entity} entityLabel={config.entityLabel} id={id} />
      )}
    </span>
  );
}

function RelationHoverCard({
  entity,
  entityLabel,
  id,
}: {
  entity: { label: string; detail: Record<string, unknown> };
  entityLabel: string;
  id: string;
}) {
  const entries = useMemo(() => {
    return Object.entries(entity.detail).filter(([k]) => k !== "id");
  }, [entity.detail]);

  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[340px] overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-lg"
      onMouseEnter={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">
          {entityLabel}
        </span>
        <span className="font-mono text-[9px] text-muted/60">{id.slice(0, 12)}…</span>
      </div>

      {/* Title */}
      <div className="border-b border-hairline px-3 py-2 font-heading text-sm font-semibold text-ink-navy">
        <span className="block truncate">{entity.label}</span>
      </div>

      {/* Details — scrollable */}
      <dl className="max-h-[280px] space-y-1 overflow-y-auto px-3 py-2">
        {entries.map(([key, val]) => (
          <div key={key} className="flex gap-2 text-[11px]">
            <dt className="w-24 shrink-0 truncate font-mono uppercase tracking-wide text-muted/70">
              {key}
            </dt>
            <dd className="min-w-0 flex-1 break-all text-ink">
              <MiniValue value={val} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MiniValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted/40 italic">—</span>;
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-muted/40 italic">—</span>;
      const str = value.join(", ");
      if (str.length > 100) {
        return <span className="break-all text-ink">{value.slice(0, 3).join(", ")}… (+{value.length - 3})</span>;
      }
      return <span className="break-all text-ink">{str}</span>;
    }
    const dict = value as Record<string, string>;
    const en = dict.en ?? Object.values(dict)[0];
    const extraCount = Object.values(dict).filter((v) => v?.trim()).length - 1;
    return (
      <span className="break-all text-ink">
        {en ?? "—"}
        {extraCount > 0 && <span className="ml-1 font-mono text-[9px] text-muted/60">(+{extraCount})</span>}
      </span>
    );
  }
  const str = String(value);
  if (str.length > 120) {
    return <span className="break-all text-ink">{str.slice(0, 117)}…</span>;
  }
  return <span className="break-all text-ink">{str}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Column classification
// ═══════════════════════════════════════════════════════════════════════════════

const ARRAY_COLUMNS = new Set(["asset_urls", "ideal_for", "not_ideal_for", "garment_style_component_ids", "placements"]);
const DICT_COLUMNS = new Set(["labels", "descriptions"]);

// ═══════════════════════════════════════════════════════════════════════════════
//  SmartCell — main entry point
// ═══════════════════════════════════════════════════════════════════════════════

export function SmartCell({
  column,
  value,
  relations = [],
}: {
  column: string;
  value: unknown;
  relations?: RelationConfig[];
}) {
  // NULL
  if (value === null || value === undefined) {
    return <span className="text-muted/50 italic">NULL</span>;
  }

  // Check if this column is a relation
  const relation = relations.find((r) => r.column === column);
  if (relation && typeof value === "string") {
    return <RelationCell id={value} config={relation} />;
  }

  // Dictionary columns (labels, descriptions)
  if (DICT_COLUMNS.has(column)) {
    return <LangDictCell value={value} compact />;
  }

  // Array columns
  if (ARRAY_COLUMNS.has(column)) {
    if (column === "asset_urls") return <ArrayTagsCell value={value} variant="asset" />;
    if (column === "ideal_for") return <ArrayTagsCell value={value} variant="positive" />;
    if (column === "not_ideal_for") return <ArrayTagsCell value={value} variant="negative" />;
    return <ArrayTagsCell value={value} />;
  }

  // Generic array
  if (Array.isArray(value)) {
    return <ArrayTagsCell value={value} />;
  }

  // Generic object
  if (typeof value === "object") {
    const str = JSON.stringify(value);
    if (str.length > 80) {
      return (
        <span className="inline-block max-w-[280px] truncate" title={str}>
          {str}
        </span>
      );
    }
    return <span className="text-ink">{str}</span>;
  }

  // Boolean
  if (typeof value === "boolean") {
    return (
      <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-medium ${
        value ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
      }`}>
        {value ? "true" : "false"}
      </span>
    );
  }

  // Numbers / strings
  const display = String(value);
  if (display.length > 60) {
    return (
      <span className="inline-block max-w-[280px] truncate text-ink" title={display}>
        {display}
      </span>
    );
  }

  return <span className="text-ink">{display}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MobileRowCard with smart rendering
// ═══════════════════════════════════════════════════════════════════════════════

export function SmartMobileCard({
  row,
  columns,
  relations = [],
}: {
  row: Record<string, unknown>;
  columns: string[];
  relations?: RelationConfig[];
}) {
  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-3 shadow-card">
      <dl className="space-y-1.5">
        {columns.map((col) => (
          <div key={col} className="flex gap-2">
            <dt className="w-28 shrink-0 truncate font-mono text-[11px] uppercase tracking-wide text-muted">
              {col}
            </dt>
            <dd className="min-w-0 flex-1 break-words text-[13px] text-ink">
              <SmartCell column={col} value={row[col]} relations={relations} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Helper: build a RelationMap from table data
// ═══════════════════════════════════════════════════════════════════════════════

export function buildRelationMap(rows: Record<string, unknown>[]): RelationMap {
  const map: RelationMap = {};
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id) continue;
    const labels = row.labels as Record<string, string> | null;
    const slug = String(row.slug ?? id);
    const label = labels?.en ?? slug;
    map[id] = { label, detail: { ...row } };
  }
  return map;
}
