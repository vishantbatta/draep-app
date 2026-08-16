"use client";

/**
 * Shared AI controls for the catalogue entity form (garment, component,
 * variation, variation type, add-on, add-on variation).
 *
 *  - useAiDescription(): per-language "AI ✦" button state + generator for
 *    the Descriptions language rows. Fills the description (and the name
 *    when the language has none).
 *  - AiRowButton: the small sparkle button rendered inside a LangRowEditor
 *    row (the form passes it via the aiAction/aiBusyLang props).
 *  - useAiImage() + AiImagePanel: "Generate AI Image" — two-step backend
 *    pipeline (prompt writer → image model) with loading states and the
 *    last prompt.
 *  - AssetImageGrid: renders asset_urls as images; each image can be
 *    removed or regenerated in place. AddAssetUrlInput: paste a URL.
 *
 * All of these only touch local form state — nothing reaches the DB until
 * the form's Save button is pressed.
 */

import { useState } from "react";
import {
  aiDescribe,
  aiGenerateImage,
  type AiEntityType,
} from "@/lib/admin-api";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Structurally identical to the LangRow duplicated in each page's form. */
export interface AiLangRow {
  id: string;
  lang: string;
  value: string;
}

export interface AiEntityContext {
  entityType: AiEntityType;
  /** Saved row id (edit forms). */
  entityId?: string | null;
  /** Parent id for unsaved rows (component/variation/addon/garment id). */
  parentId?: string | null;
}

let _aiRowCounter = 0;

function rowsToDict(rows: AiLangRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.lang && r.value.trim()) out[r.lang] = r.value.trim();
  }
  return out;
}

// ─── Sparkle button (rendered per language row) ─────────────────────────────

export function AiRowButton({
  busy,
  onClick,
  title,
}: {
  busy?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title ?? "Write with AI"}
      aria-label={title ?? "Write with AI"}
      className="tap mt-0.5 flex h-8 shrink-0 items-center gap-1 rounded-pill border border-hairline-strong px-2 text-[11px] font-medium text-accent-text transition hover:bg-mist-navy disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 30" />
          <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5l1.3 3.7L13 6.5l-3.7 1.3L8 11.5l-1.3-3.7L3 6.5l3.7-1.3L8 1.5z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12.5 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      )}
      <span className="hidden md:inline">AI</span>
    </button>
  );
}

// ─── Inline error note ──────────────────────────────────────────────────────

export function AiErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-1 rounded-card border border-error-border bg-error-bg px-2.5 py-1.5 text-[11px] text-error-text">
      {error}
    </p>
  );
}

// ─── AI description hook ────────────────────────────────────────────────────

export function useAiDescription() {
  const [busyLang, setBusyLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generateForLang(opts: {
    context: AiEntityContext;
    lang: string;
    labelRows: AiLangRow[];
    descRows: AiLangRow[];
    setLabelRows: (rows: AiLangRow[]) => void;
    setDescRows: (rows: AiLangRow[]) => void;
  }): Promise<void> {
    const { context, lang, labelRows, descRows, setLabelRows, setDescRows } = opts;
    if (!lang || busyLang) return;

    const name = labelRows.find((r) => r.lang === lang)?.value.trim() ?? "";
    const existingDescription =
      descRows.find((r) => r.lang === lang)?.value.trim() ?? "";

    setBusyLang(lang);
    setError(null);
    try {
      const res = await aiDescribe({
        entity_type: context.entityType,
        entity_id: context.entityId ?? null,
        parent_id: context.parentId ?? null,
        language: lang,
        name: name || null,
        names: rowsToDict(labelRows),
        existing_description: existingDescription || null,
        descriptions: rowsToDict(descRows),
      });

      // Description: update the row for this language, or add one.
      const hasDescRow = descRows.some((r) => r.lang === lang);
      const nextDescRows = hasDescRow
        ? descRows.map((r) =>
            r.lang === lang ? { ...r, value: res.description } : r,
          )
        : [
            ...descRows,
            { id: `ai${++_aiRowCounter}`, lang, value: res.description },
          ];
      setDescRows(nextDescRows);

      // Name: only fill when the language had none (AI created it).
      if (!name && res.name) {
        const hasLabelRow = labelRows.some((r) => r.lang === lang);
        const nextLabelRows = hasLabelRow
          ? labelRows.map((r) =>
              r.lang === lang && !r.value.trim()
                ? { ...r, value: res.name as string }
                : r,
            )
          : [
              ...labelRows,
              { id: `ai${++_aiRowCounter}`, lang, value: res.name },
            ];
        setLabelRows(nextLabelRows);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "AI description failed. Try again.",
      );
    } finally {
      setBusyLang(null);
    }
  }

  return { busyLang, error, generateForLang, clearError: () => setError(null) };
}

// ─── AI image hook ──────────────────────────────────────────────────────────

export function useAiImage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  /** Runs the two-step pipeline; resolves to the new image URL, or null on failure. */
  async function generate(opts: {
    context: AiEntityContext;
    labelRows: AiLangRow[];
    descRows: AiLangRow[];
  }): Promise<string | null> {
    if (loading) return null;
    setLoading(true);
    setError(null);
    try {
      const res = await aiGenerateImage({
        entity_type: opts.context.entityType,
        entity_id: opts.context.entityId ?? null,
        parent_id: opts.context.parentId ?? null,
        names: rowsToDict(opts.labelRows),
        descriptions: rowsToDict(opts.descRows),
      });
      setLastPrompt(res.prompt);
      return res.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "AI image generation failed. Try again.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, lastPrompt, generate };
}

// ─── Asset image gallery (each image regenerable in place) ──────────────────

export function AssetImageGrid({
  urls,
  busy,
  onRemove,
  onRegenerate,
}: {
  urls: string[];
  busy?: boolean;
  onRemove: (url: string) => void;
  /** Regenerating replaces THIS image's URL with a freshly generated one. */
  onRegenerate: (url: string) => void;
}) {
  if (urls.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-hairline-strong px-3 py-3 text-[12px] text-muted">
        No images yet — generate one with AI below, or paste a URL.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {urls.map((url) => (
        <div
          key={url}
          className="overflow-hidden rounded-card border border-hairline-strong bg-chalk-white"
        >
          <div className="relative aspect-square">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={url}
              className="block h-full w-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
            </a>
            <button
              type="button"
              onClick={() => onRegenerate(url)}
              disabled={busy}
              title="Regenerate this image with AI"
              aria-label="Regenerate this image with AI"
              className="tap absolute left-1 top-1 flex h-7 w-7 items-center justify-center rounded-pill border border-hairline-strong bg-chalk-white/90 text-ink-navy transition hover:bg-mist-navy disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 30" />
                  <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M13.7 1.8v2.7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => onRemove(url)}
              title="Remove image"
              aria-label="Remove image"
              className="tap absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-pill border border-hairline-strong bg-chalk-white/90 text-muted transition hover:bg-red-50 hover:text-red-600"
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p
            className="truncate border-t border-hairline px-1.5 py-1 font-mono text-[9px] text-muted"
            title={url}
          >
            {url}
          </p>
        </div>
      ))}
    </div>
  );
}

// ─── Manual URL input under the gallery ─────────────────────────────────────

export function AddAssetUrlInput({ onAdd }: { onAdd: (url: string) => void }) {
  const [value, setValue] = useState("");

  function add() {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue("");
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Paste an existing image URL…"
        className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none focus:border-ink-navy"
      />
      <button
        type="button"
        onClick={add}
        className="tap shrink-0 rounded-pill border border-hairline-strong px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
      >
        Add URL
      </button>
    </div>
  );
}

// ─── AI image panel (generate button + loading + prompt) ────────────────────

export function AiImagePanel({
  loading,
  error,
  lastPrompt,
  onGenerate,
}: {
  loading: boolean;
  error: string | null;
  lastPrompt: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="mt-2.5 rounded-card border border-hairline bg-mist-navy/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="tap flex items-center gap-1.5 rounded-pill border border-accent-text/40 bg-chalk-white px-3 py-1.5 text-[12px] font-medium text-accent-text transition hover:bg-mist-navy disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 30" />
                <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Generating image… (can take ~15-30s)
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="5.6" cy="6.4" r="1.1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 11.5l3.4-3 2.5 2.2 2.4-2.8 3.7 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              Generate AI Image
            </>
          )}
        </button>
        <span className="text-[11px] text-muted">
          Writes a prompt from the name, description &amp; parent tree, then paints the swatch. ↻ on any image regenerates it in place.
        </span>
      </div>

      <AiErrorNote error={error} />

      {loading && (
        <div className="mt-2 flex h-28 items-center justify-center rounded-card border border-dashed border-hairline-strong bg-chalk-white/60">
          <div className="flex flex-col items-center gap-1.5">
            <svg className="h-5 w-5 animate-spin text-accent-text" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 30" />
              <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="font-mono text-[11px] text-muted">
              Writing the prompt, then rendering the image…
            </span>
          </div>
        </div>
      )}

      {lastPrompt && !loading && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[11px] text-ink-navy">
            Prompt used for the last generated image
          </summary>
          <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-card border border-hairline bg-chalk-white px-2.5 py-2 text-[11px] leading-relaxed text-ink">
            {lastPrompt}
          </p>
        </details>
      )}
    </div>
  );
}
