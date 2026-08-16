"use client";

import { useState, useCallback } from "react";
import { FALLBACK_IMAGE } from "@/lib/admin-api";

// ═══════════════════════════════════════════════════════════════════════════════
//  Thumbnail — shows first asset or fallback
// ═══════════════════════════════════════════════════════════════════════════════

export function Thumbnail({
  urls,
  className = "",
}: {
  urls: string[] | null | undefined;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const src = urls && urls.length > 0 && !errored ? urls[0] : FALLBACK_IMAGE;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setErrored(true)}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Card — generic card wrapper with hover actions
// ═══════════════════════════════════════════════════════════════════════════════

export function Card({
  image,
  title,
  subtitle,
  badges = [],
  meta,
  onClick,
  onEdit,
  onDelete,
}: {
  image?: string[] | null;
  title: string;
  subtitle?: string | null;
  badges?: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[];
  meta?: React.ReactNode;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card transition hover:border-hairline-strong hover:shadow-lg">
      {/* Clickable area */}
      <button
        onClick={onClick}
        className="block w-full text-left"
        disabled={!onClick}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] overflow-hidden bg-mist-navy">
          <Thumbnail urls={image} className="h-full w-full object-cover" />
          {badges.length > 0 && (
            <div className="absolute left-2 top-2 flex flex-wrap gap-1">
              {badges.map((b, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm ${
                    b.variant === "positive"
                      ? "bg-green-500/90 text-white"
                      : b.variant === "negative"
                        ? "bg-red-500/90 text-white"
                        : b.variant === "accent"
                          ? "bg-tape/80 text-ink-navy"
                          : "bg-chalk-white/90 text-ink-navy"
                  }`}
                >
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Text */}
        <div className="p-4">
          <h3 className="font-heading text-[15px] font-semibold leading-tight text-ink-navy">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-snug text-muted">
              {subtitle}
            </p>
          )}
          {meta && <div className="mt-2">{meta}</div>}
        </div>
      </button>

      {/* Hover actions */}
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        {onEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="tap flex h-8 w-8 items-center justify-center rounded-lg bg-chalk-white/90 text-ink-navy shadow-sm backdrop-blur-sm transition hover:bg-chalk-white"
            title="Edit"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="tap flex h-8 w-8 items-center justify-center rounded-lg bg-chalk-white/90 text-red-600 shadow-sm backdrop-blur-sm transition hover:bg-red-50"
            title="Delete"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 4.5h9M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 4.5l.5 8a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Breadcrumb
// ═══════════════════════════════════════════════════════════════════════════════

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[13px]">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <svg className="h-3 w-3 text-muted/50" viewBox="0 0 12 12" fill="none">
                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
            {crumb.onClick && !isLast ? (
              <button
                onClick={crumb.onClick}
                className="rounded px-1 py-0.5 text-muted transition hover:bg-mist-navy hover:text-ink"
              >
                {crumb.label}
              </button>
            ) : (
              <span className={`font-medium ${isLast ? "text-ink-navy" : "text-muted"}`}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Section header with Add button
// ═══════════════════════════════════════════════════════════════════════════════

export function SectionHeader({
  title,
  count,
  onAdd,
  addLabel = "Add",
  actions,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  addLabel?: string;
  /** Extra controls rendered left of the Add button (e.g. Bulk Generate). */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <h2 className="font-heading text-lg font-bold text-ink-navy">{title}</h2>
        {count !== undefined && (
          <span className="inline-flex min-w-[24px] items-center justify-center rounded-pill bg-mist-navy px-2 py-0.5 font-mono text-[11px] font-medium text-ink-navy">
            {count}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {onAdd && (
          <button
            onClick={onAdd}
            className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-3.5 py-1.5 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Modal — generic overlay
// ═══════════════════════════════════════════════════════════════════════════════

export function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
  headerAction,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  // Optional control rendered in the header, left of the close ×.
  headerAction?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-navy/40 p-4 backdrop-blur-sm md:p-8"
      onClick={onClose}
    >
      <div
        className={`relative my-auto w-full ${maxWidth} rounded-card border border-hairline bg-chalk-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
          <h3 className="font-heading text-base font-semibold text-ink-navy">{title}</h3>
          <div className="flex items-center gap-2">
            {headerAction}
            <button
              onClick={onClose}
              className="tap flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-mist-navy hover:text-ink-navy"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Form field primitives
// ═══════════════════════════════════════════════════════════════════════════════

export function Field({
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
      <span className="mb-1 block text-[12px] font-medium text-ink-navy">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink-navy"
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink-navy"
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "—",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink-navy"
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Error / Loading / Empty states
// ═══════════════════════════════════════════════════════════════════════════════

export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex h-56 items-center justify-center">
      <div className="flex items-center gap-2.5">
        <svg className="h-5 w-5 animate-spin text-muted" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
          <path d="M10 2a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-[13px] text-muted">{message}</span>
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
        <svg className="h-6 w-6 text-red-500" viewBox="0 0 20 20" fill="none">
          <path d="M10 6v5M10 14v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </div>
      <div className="text-[13px] text-red-600">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="tap rounded-pill border border-hairline-strong px-4 py-1.5 text-[12px] text-ink hover:bg-mist-navy">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message, onAdd, addLabel }: { message: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center gap-4 rounded-card border border-dashed border-hairline-strong bg-chalk-white/50">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-mist-navy">
        <svg className="h-7 w-7 text-muted" viewBox="0 0 20 20" fill="none">
          <rect x="3" y="4" width="14" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M3 8h14" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 2v3M13 2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M7 12h6M7 15h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-center text-[13px] text-muted">{message}</div>
      {onAdd && (
        <button onClick={onAdd} className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-4 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95">
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {addLabel ?? "Add"}
        </button>
      )}
    </div>
  );
}

export function ConfirmDelete({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} maxWidth="max-w-sm">
      <p className="text-[14px] text-ink">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="tap rounded-card border border-hairline-strong px-3 py-1.5 text-[13px] text-ink hover:bg-mist-navy">
          Cancel
        </button>
        <button onClick={onConfirm} className="tap rounded-card bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-700">
          Delete
        </button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ReorderableCardGrid — card grid with native HTML5 drag-and-drop reordering
// ═══════════════════════════════════════════════════════════════════════════════

interface ReorderableItem {
  id: string;
  slug?: string | null;
  labels?: Record<string, string> | null;
  asset_urls?: string[] | null;
  descriptions?: Record<string, string> | null;
}

export function ReorderableCardGrid<T extends ReorderableItem>({
  items,
  onOpen,
  onEdit,
  onDelete,
  badges,
  onReorder,
}: {
  items: T[];
  onOpen: (item: T) => void;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
  badges?: (item: T) => { label: string; variant?: "default" | "positive" | "negative" | "accent" }[];
  onReorder: (reorderedItems: T[]) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox to initiate drag
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex !== null && dragIndex !== index) {
      setOverIndex(index);
    }
  }, [dragIndex]);

  const handleDrop = useCallback((index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    const reordered = [...items];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(index, 0, moved);
    onReorder(reordered);
    setDragIndex(null);
    setOverIndex(null);
  }, [dragIndex, items, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setOverIndex(null);
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item, index) => {
        const title = item.labels?.en?.trim()
          || (item.labels ? (Object.values(item.labels).find((v) => v?.trim()) ?? item.slug ?? item.id) : (item.slug ?? item.id));
        const subtitle = (item.descriptions?.en?.trim()
          || (item.descriptions ? (Object.values(item.descriptions).find((v) => v?.trim()) ?? null) : null))
          ?? undefined;
        const isDragging = dragIndex === index;
        const isOver = overIndex === index && dragIndex !== null && dragIndex !== index;

        return (
          <div
            key={item.id}
            draggable
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDrop={handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={`relative transition ${isDragging ? "opacity-40" : ""} ${isOver ? "ring-2 ring-tape ring-offset-2 rounded-card" : ""}`}
          >
            {/* Drag handle — left edge, vertically centered, hover-only */}
            <div className="absolute left-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 cursor-grab items-center justify-center rounded-lg bg-chalk-white/90 text-ink-navy shadow-sm backdrop-blur-sm opacity-0 transition group-hover:opacity-100 active:cursor-grabbing">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                <circle cx="5" cy="4" r="1.2" fill="currentColor" />
                <circle cx="5" cy="8" r="1.2" fill="currentColor" />
                <circle cx="5" cy="12" r="1.2" fill="currentColor" />
                <circle cx="11" cy="4" r="1.2" fill="currentColor" />
                <circle cx="11" cy="8" r="1.2" fill="currentColor" />
                <circle cx="11" cy="12" r="1.2" fill="currentColor" />
              </svg>
            </div>

            <Card
              image={item.asset_urls}
              title={title}
              subtitle={subtitle}
              badges={badges ? badges(item) : []}
              onClick={() => onOpen(item)}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
            />
          </div>
        );
      })}
    </div>
  );
}
