"use client";

/**
 * AutoDesignFlow — "Share a design with us", the second path of /app/create.
 *
 * A six-stage state machine. The analysis result is converted ONCE into
 * MYOD's `Selections` map (lib/auto-design); that one object feeds both the
 * gap-filling MyodSheet and the review sheet, so the order the customer
 * finally places is byte-identical to a hand-built MYOD design.
 *
 *   photos ──► uploading ──► analyzing (SSE checklist)
 *                                │
 *                ┌───────────────┼──────────────────────┐
 *        garment unresolved   missing = []          missing = [..]
 *                │               │                      │
 *          pick-garment ──►  review (draft sheet)  ◄── fill-missing (MyodSheet
 *          (re-analyze)          │                      over just those steps)
 *                                ▼
 *                        /app/orders/{id}
 *
 * Every stage retries from ITS OWN stage: an upload failure re-uploads from
 * memory, an analysis failure re-streams with the same hosted URLs (no
 * re-upload), an order failure stays inside the review sheet with the
 * tweaks intact. The host (CreateTab) owns the navy header; this component
 * reports what to show there (title/body, or MyodSheet's step while filling
 * gaps) and which Back action applies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AutoDesignOrderSheet } from "@/components/auto-design/AutoDesignOrderSheet";
import { GarmentPicker } from "@/components/myod/GarmentPicker";
import { extrasDefaults, MyodSheet, type HostedStep } from "@/components/myod/MyodSheet";
import { DesignPhotoPicker } from "@/components/photo/DesignPhotoPicker";
import { Button } from "@/components/ui/Button";
import { Check, Sparkles } from "@/components/ui/icons";
import { track } from "@/lib/analytics";
import {
  analyzeDesignStream,
  uploadDesignPhotos,
  type AutoDesignDone,
  type AutoDesignStageEvent,
} from "@/lib/api/autoDesign";
import { getGarmentTree } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { aiResultToSelections, selectionsToSeedItems } from "@/lib/auto-design";
import { buildDesignSteps, type Selections } from "@/lib/myod-steps";
import { strings } from "@/lib/strings";
import type { GarmentListItem, GarmentTreeOut } from "@/types/api";

type Stage =
  | "photos"
  | "uploading"
  | "analyzing"
  | "pick-garment"
  | "fill-missing"
  | "review"
  | "error";

/** Copy for the host header while no MYOD step is active. */
export interface AutoDesignHeader {
  title: string;
  body?: string;
}

/** A running stage shows "still reading…" after this long. */
const SLOW_STAGE_MS = 8000;

interface ChecklistRow {
  key: string;
  label: string;
  status: "running" | "done" | "missed";
  detail?: string;
}

/** Fold one SSE stage event into the checklist rows. */
function applyStage(rows: ChecklistRow[], e: AutoDesignStageEvent): ChecklistRow[] {
  const key = `${e.step}:${e.component_id ?? ""}`;
  if (e.status === "start") {
    return rows.some((r) => r.key === key)
      ? rows
      : [...rows, { key, label: e.label, status: "running" }];
  }
  const single = e.step === "component" || e.step === "garment";
  const missed = single && !e.picked;
  const detail = single
    ? e.picked?.label ?? strings.autoDesign.notSeen
    : strings.autoDesign.found(e.found ?? 0);
  const next: ChecklistRow = { key, label: e.label, status: missed ? "missed" : "done", detail };
  return rows.some((r) => r.key === key)
    ? rows.map((r) => (r.key === key ? next : r))
    : [...rows, next];
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "design_ai_rate_limited") {
    return strings.autoDesign.errorBusy;
  }
  return err instanceof Error && err.message ? err.message : strings.autoDesign.errorTitle;
}

export function AutoDesignFlow({
  garments,
  garmentsError,
  onRetryGarments,
  footerInset,
  onBackChange,
  onStepChange,
  onHeaderChange,
}: {
  /** The enabled garments (CreateTab already loads them) — the fallback picker. */
  garments: GarmentListItem[] | null;
  garmentsError: string | null;
  onRetryGarments: () => void;
  footerInset?: string;
  /** Back action for the host header: null = "leave this flow" (host decides). */
  onBackChange?: (back: (() => void) | null) => void;
  /** MyodSheet's active step while filling gaps (host shows the step rail). */
  onStepChange?: (step: HostedStep | null) => void;
  /** Title/body for every other stage. */
  onHeaderChange?: (header: AutoDesignHeader | null) => void;
}) {
  const [stage, setStage] = useState<Stage>("photos");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [garmentId, setGarmentId] = useState<string | null>(null);
  const [rows, setRows] = useState<ChecklistRow[]>([]);
  const [tree, setTree] = useState<GarmentTreeOut | null>(null);
  const [selections, setSelections] = useState<Selections>({});
  const [missing, setMissing] = useState<string[]>([]);
  // What the photos settled, for the review summary — `missing` empties once
  // the customer answers the gap steps, this stays the analysis' own score.
  const [aiMissingCount, setAiMissingCount] = useState(0);
  const [error, setError] = useState<{
    message: string;
    retry: "upload" | "analyze" | "finish";
  } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);
  const lastResultRef = useRef<AutoDesignDone | null>(null);

  useEffect(() => {
    track({ event: "auto_design_opened" });
    return () => abortRef.current?.abort();
  }, []);

  // ── Stage transitions ──────────────────────────────────────────────

  /** Resolve the garment tree, merge catalog defaults UNDER the AI picks
      (AI wins; default-on add-ons and fit defaults fill the rest — the same
      baseline MyodSheet starts from) and branch on the gaps. */
  const finish = useCallback(async (res: AutoDesignDone) => {
    lastResultRef.current = res;
    try {
      const t = await getGarmentTree(res.garment_id);
      const ai = aiResultToSelections(res);
      const merged = { ...extrasDefaults(buildDesignSteps(t)), ...ai };
      setTree(t);
      setGarmentId(res.garment_id);
      setSelections(merged);
      setMissing(res.missing_critical);
      setAiMissingCount(res.missing_critical.length);
      track({
        event: "auto_design_analyzed",
        garment_detected: true,
        missing_count: res.missing_critical.length,
        found_count: res.selections.length + res.addons.length,
        ms: Date.now() - startedAtRef.current,
      });
      if (res.missing_critical.length === 0) {
        setStage("review");
        setReviewOpen(true);
      } else {
        track({ event: "auto_design_fallback_myod", missing_count: res.missing_critical.length });
        setStage("fill-missing");
      }
    } catch (err) {
      setError({ message: errorMessage(err), retry: "finish" });
      setStage("error");
    }
  }, []);

  const startAnalyze = useCallback(
    async (urls: string[], gid: string | null) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRows([]);
      setError(null);
      setStage("analyzing");
      startedAtRef.current = Date.now();
      try {
        const outcome = await analyzeDesignStream({
          imageUrls: urls,
          garmentId: gid ?? undefined,
          signal: ctrl.signal,
          onStage: (e) => setRows((prev) => applyStage(prev, e)),
        });
        if (ctrl.signal.aborted) return;
        if (outcome.kind === "garment_unresolved") {
          track({
            event: "auto_design_analyzed",
            garment_detected: false,
            missing_count: 0,
            found_count: 0,
            ms: Date.now() - startedAtRef.current,
          });
          setStage("pick-garment");
          return;
        }
        await finish(outcome.result);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        track({
          event: "auto_design_failed",
          code: err instanceof ApiError ? err.code : "unknown",
        });
        setError({ message: errorMessage(err), retry: "analyze" });
        setStage("error");
      }
    },
    [finish],
  );

  const startUpload = useCallback(async () => {
    if (!files.length) return;
    setError(null);
    setStage("uploading");
    try {
      const urls = await uploadDesignPhotos(files);
      setUploadedUrls(urls);
      track({ event: "auto_design_photos_added", count: urls.length });
      await startAnalyze(urls, garmentId);
    } catch (err) {
      setError({ message: errorMessage(err), retry: "upload" });
      setStage("error");
    }
  }, [files, garmentId, startAnalyze]);

  const backToPhotos = useCallback(() => {
    abortRef.current?.abort();
    setReviewOpen(false);
    setError(null);
    setStage("photos");
  }, []);

  const retry = useCallback(() => {
    if (!error) return;
    if (error.retry === "upload") void startUpload();
    else if (error.retry === "analyze") void startAnalyze(uploadedUrls, garmentId);
    else if (lastResultRef.current) void finish(lastResultRef.current);
  }, [error, startUpload, startAnalyze, finish, uploadedUrls, garmentId]);

  /** The gap steps are answered — the full map comes back; on to review. */
  const handleStepsComplete = useCallback(
    (sels: Selections) => {
      setSelections(sels);
      setMissing([]);
      onStepChange?.(null);
      setStage("review");
      setReviewOpen(true);
    },
    [onStepChange],
  );

  // ── Host header + Back ─────────────────────────────────────────────

  useEffect(() => {
    if (stage === "fill-missing") return; // MyodSheet reports its step
    onStepChange?.(null);
    const header: AutoDesignHeader =
      stage === "photos" || stage === "uploading"
        ? { title: strings.autoDesign.pickerTitle, body: strings.autoDesign.pickerBody }
        : stage === "analyzing"
          ? { title: strings.autoDesign.analyzingTitle, body: strings.autoDesign.analyzingBody }
          : stage === "pick-garment"
            ? { title: strings.autoDesign.garmentTitle, body: strings.autoDesign.garmentBody }
            : stage === "review"
              ? { title: strings.autoDesign.reviewTitle, body: strings.autoDesign.reviewBody }
              : { title: strings.autoDesign.errorTitle };
    onHeaderChange?.(header);
  }, [stage, onStepChange, onHeaderChange]);

  useEffect(() => {
    if (stage === "fill-missing") return; // forwarded from MyodSheet below
    onBackChange?.(stage === "photos" || stage === "uploading" ? null : backToPhotos);
  }, [stage, onBackChange, backToPhotos]);

  // MyodSheet reports null on its first step — there, Back means "back to
  // the photos", not "leave the flow".
  const handleMyodBack = useCallback(
    (back: (() => void) | null) => onBackChange?.(back ?? backToPhotos),
    [onBackChange, backToPhotos],
  );

  useEffect(
    () => () => {
      onBackChange?.(null);
      onStepChange?.(null);
      onHeaderChange?.(null);
    },
    [onBackChange, onStepChange, onHeaderChange],
  );

  // ── Derived ────────────────────────────────────────────────────────

  const addonIds = useMemo(() => new Set((tree?.addons ?? []).map((a) => a.id)), [tree]);
  const seeds = useMemo(() => selectionsToSeedItems(selections, addonIds), [selections, addonIds]);
  const basePrice =
    tree?.base_price ?? garments?.find((g) => g.id === garmentId)?.base_price ?? null;
  const criticalTotal = useMemo(
    () => (tree ? buildDesignSteps(tree).filter((s) => !s.isExtras).length : 0),
    [tree],
  );
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // ── Render ─────────────────────────────────────────────────────────

  if (stage === "photos" || stage === "uploading") {
    return (
      <DesignPhotoPicker
        files={files}
        onChange={setFiles}
        onAnalyze={() => void startUpload()}
        busy={stage === "uploading"}
        busyLabel={strings.autoDesign.uploading}
      />
    );
  }

  if (stage === "analyzing") {
    return (
      <div className="mx-auto flex w-full max-w-column flex-col gap-4 px-4 pb-6">
        <PhotoStrip urls={previews} />
        <Checklist rows={rows} />
        <button
          type="button"
          onClick={backToPhotos}
          className="self-center rounded-pill px-4 py-1.5 text-caption font-semibold text-muted transition-colors hover:text-ink-navy"
        >
          {strings.autoDesign.cancel}
        </button>
      </div>
    );
  }

  if (stage === "pick-garment") {
    return (
      <div className="flex flex-col gap-2">
        <div className="mx-auto w-full max-w-column px-4">
          <PhotoStrip urls={previews} />
        </div>
        <GarmentPicker
          garments={garments}
          error={garmentsError}
          onRetry={onRetryGarments}
          onPick={(g) => {
            setGarmentId(g.id);
            void startAnalyze(uploadedUrls, g.id);
          }}
        />
      </div>
    );
  }

  if (stage === "fill-missing" && garmentId) {
    return (
      <div className="flex flex-col gap-3">
        <div className="mx-auto w-full max-w-column px-4">
          <div className="flex items-start gap-3 rounded-card border border-hairline bg-chalk-white p-3 shadow-card">
            <span
              aria-hidden
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-chalk-white"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              <Sparkles size={16} />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-[15px] font-semibold leading-snug text-ink-navy">
                {strings.autoDesign.gapsTitle(missing.length)}
              </p>
              <p className="mt-0.5 text-caption leading-snug text-muted">
                {strings.autoDesign.gapsBody}
              </p>
            </div>
          </div>
        </div>
        <MyodSheet
          key={garmentId}
          garmentId={garmentId}
          initialSelections={selections}
          onlyStepIds={missing}
          onStepsComplete={handleStepsComplete}
          footerInset={footerInset}
          onBackChange={handleMyodBack}
          onStepChange={onStepChange}
        />
      </div>
    );
  }

  if (stage === "review" && garmentId) {
    return (
      <div className="mx-auto flex w-full max-w-column flex-col gap-4 px-4 pb-6">
        <PhotoStrip urls={previews} />
        <div className="flex flex-col gap-3 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-chalk-white"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              <Check size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-[15px] font-semibold leading-snug text-ink-navy">
                {strings.autoDesign.reviewSummary(criticalTotal - aiMissingCount, criticalTotal)}
              </p>
              <p className="mt-0.5 text-caption leading-snug text-muted">
                {strings.autoDesign.reviewBody}
              </p>
            </div>
          </div>
          <Checklist rows={rows} compact />
          <Button fullWidth onClick={() => setReviewOpen(true)}>
            {strings.autoDesign.reviewCta}
          </Button>
        </div>
        <AutoDesignOrderSheet
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          garmentId={garmentId}
          basePrice={basePrice}
          seeds={seeds}
          assets={uploadedUrls}
        />
      </div>
    );
  }

  // error (or an impossible stage without a garment — treat as an error)
  return (
    <div className="mx-auto flex w-full max-w-column flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="text-body text-ink">{error?.message ?? strings.autoDesign.errorTitle}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {error && <Button onClick={retry}>{strings.autoDesign.errorRetry}</Button>}
        <Button variant="secondary" onClick={backToPhotos}>
          {strings.autoDesign.startOver}
        </Button>
      </div>
    </div>
  );
}

/* ─── Pieces ──────────────────────────────────────────────────────────── */

function PhotoStrip({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {urls.map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={u}
          src={u}
          alt={`Design photo ${i + 1}`}
          className="h-20 w-16 flex-none rounded-card border border-hairline object-cover"
        />
      ))}
    </div>
  );
}

/**
 * The live progress log. Rows only ever append, so the eye reads top-down
 * as the analysis moves through the design; the current row spins.
 */
function Checklist({ rows, compact = false }: { rows: ChecklistRow[]; compact?: boolean }) {
  if (!rows.length) {
    return compact ? null : (
      <div className="flex items-center gap-3 rounded-card border border-hairline bg-chalk-white px-4 py-3 shadow-card">
        <Spinner />
        <p className="text-caption text-muted">{strings.autoDesign.analyzingBody}</p>
      </div>
    );
  }
  return (
    <ul
      className={
        "flex flex-col divide-y divide-hairline rounded-card border border-hairline bg-chalk-white shadow-card " +
        (compact ? "text-[13px]" : "")
      }
    >
      {rows.map((r) => (
        <ChecklistRowItem key={r.key} row={r} />
      ))}
    </ul>
  );
}

/** One checklist row. A stage normally answers in seconds; if one is still
 *  running after SLOW_STAGE_MS the spinner gains a "still reading…" note so
 *  the wait reads as progress, not a freeze. */
function ChecklistRowItem({ row }: { row: ChecklistRow }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (row.status !== "running") {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), SLOW_STAGE_MS);
    return () => clearTimeout(t);
  }, [row.status]);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex h-6 w-6 flex-none items-center justify-center">
        {row.status === "running" ? (
          <Spinner />
        ) : row.status === "done" ? (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-chalk-white"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            <Check size={13} />
          </span>
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline-strong text-muted">
            —
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-ink-navy">{row.label}</span>
      <span
        className={
          "min-w-0 max-w-[50%] truncate text-right text-caption " +
          (row.status === "missed" ? "text-muted" : "text-accent-text")
        }
      >
        {row.status === "running" && slow ? strings.autoDesign.stillReading : row.detail ?? ""}
      </span>
    </li>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-4 w-4 animate-spin rounded-full border-2 border-ink-navy/20 border-t-ink-navy"
    />
  );
}
