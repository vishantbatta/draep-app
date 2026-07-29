"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  scCompleteJob,
  scCreateMaterial,
  scDeleteMaterial,
  scFetchJob,
  scFetchMetrics,
  scSaveMeasurements,
  scStartJob,
  scUpdateMaterial,
  scUploadPhotos,
  type SCGarmentOrderMaterial,
  type SCJob,
  type SCMaterialInput,
  type SCMetric,
} from "@/lib/style-captain-api";
import {
  existingValue,
  humanStatus,
  pickLabel,
  statusBadgeClass,
} from "@/lib/sc-helpers";
import {
  MetricCard,
  MetricInputBar,
  type MetricDraft,
} from "@/components/style-captain/MetricCard";
import { EditMetricSheet } from "@/components/style-captain/EditMetricSheet";
import { ColorPickerCamera } from "@/components/style-captain/ColorPickerCamera";
import { BottomSheet } from "@/components/style-captain/BottomSheet";
import { VoiceNoteRecorder } from "@/components/style-captain/VoiceNoteRecorder";
import {
  downloadMeasurementJobPdf,
  type PdfProgressFn,
} from "@/lib/job-pdf";
import type {
  BodyMeasurementWithMetric,
  GarmentMeasurementGroup,
  GarmentOrderMaterialRow,
  MeasurementJobRow,
  MeasurementMetricRow,
  MeasurementReadingRow,
  OrderRow,
  UserRow,
} from "@/lib/admin-api";

// ─── Phase state ────────────────────────────────────────────────────────────
//
// Two sections, each with a checkpoint:
//   Section 1 = Body measurements (all measurement_metrics)
//     "capture" → step through metrics → "checkpoint" (review + notes)
//   Section 2 = Garment materials (cloth/addon capture)
//     "garment" → "notes" (final checkpoint + complete)

type Phase = "capture" | "checkpoint" | "garment" | "notes" | "success";

// Languages for the checkpoint review toggle
const LANG_ORDER = ["en", "hi", "kn", "ta", "te"];
const LANG_TAGS: Record<string, string> = {
  en: "EN",
  hi: "हि",
  kn: "ಕನ",
  ta: "த",
  te: "తె",
};

export default function MeasureJobPage() {
  const router = useRouter();
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<SCJob | null>(null);
  const [metrics, setMetrics] = useState<SCMetric[]>([]);

  const [phase, setPhase] = useState<Phase>("capture");
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, MetricDraft>>({});
  const [notes, setNotes] = useState("");
  const [voiceNoteUrl, setVoiceNoteUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<SCGarmentOrderMaterial | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, m] = await Promise.all([
        scFetchJob(jobId),
        scFetchMetrics(),
      ]);
      setJob(j);
      setMetrics(m);

      // Pre-fill drafts from any existing readings
      const initial: Record<string, MetricDraft> = {};
      let firstUnfilledIdx = -1;
      let allMetricsFilled = true;

      for (let i = 0; i < m.length; i++) {
        const metric = m[i];
        const ex = existingValue(j, metric.id);
        initial[metric.id] = {
          metricId: metric.id,
          valueNumeric: ex.numeric,
          valueText: ex.text,
          unit: ex.unit ?? metric.unit,
        };
        const isFilled =
          ex.numeric !== null || (ex.text ?? "").trim() !== "";
        if (!isFilled) {
          allMetricsFilled = false;
          if (firstUnfilledIdx === -1) firstUnfilledIdx = i;
        }
      }
      setDrafts(initial);
      setNotes(j.notes ?? "");

      // Smart phase jumping — only on first load
      if (!hasInitialized) {
        const hasMeasurements = j.measurements.length > 0;
        const allGarmentsHaveCloth =
          j.garment_orders.length > 0 &&
          j.garment_orders.every((go) =>
            go.materials.some((mat) => mat.type === "cloth"),
          );

        if (hasMeasurements && allMetricsFilled && allGarmentsHaveCloth) {
          // Everything done — final notes
          setPhase("notes");
        } else if (hasMeasurements && allGarmentsHaveCloth) {
          // Body + garments done, just need final notes
          setPhase("notes");
        } else if (hasMeasurements && allMetricsFilled) {
          // All body metrics done — go to checkpoint (→ garment next)
          setPhase("checkpoint");
        } else if (hasMeasurements && firstUnfilledIdx > 0) {
          // Some metrics filled — jump to first unfilled
          setStep(firstUnfilledIdx);
        }
        setHasInitialized(true);
      }

      if (j.status === "scheduled") {
        try {
          await scStartJob(jobId);
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load job");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalSteps = metrics.length;
  const currentMetric = metrics[step] ?? null;
  const currentDraft = currentMetric ? drafts[currentMetric.id] : null;

  function updateDraft(next: MetricDraft) {
    if (!currentMetric) return;
    setDrafts((prev) => ({ ...prev, [next.metricId]: next }));
  }

  function updateDraftById(metricId: string, next: MetricDraft) {
    setDrafts((prev) => ({ ...prev, [metricId]: next }));
  }

  /**
   * Fire-and-forget save of a single metric to the backend (upsert).
   * Non-blocking — shows a subtle indicator but never interrupts navigation.
   */
  function saveStepSilently(draft: MetricDraft | undefined) {
    if (!job || !draft) return;
    const hasValue =
      draft.valueNumeric !== null || (draft.valueText ?? "").trim() !== "";
    if (!hasValue) return;
    setSavingStep(true);
    scSaveMeasurements(job.id, [
      {
        measurement_metric_id: draft.metricId,
        value_numeric: draft.valueNumeric,
        value_text: draft.valueText,
        unit: draft.unit,
      },
    ])
      .catch(() => {
        /* best-effort — will be re-saved at checkpoint */
      })
      .finally(() => setSavingStep(false));
  }

  function nextStep() {
    // Save current metric before advancing
    saveStepSilently(drafts[currentMetric?.id ?? ""]);
    if (step < totalSteps - 1) {
      setStep((s) => s + 1);
    } else {
      setPhase("checkpoint");
    }
  }

  function prevStep() {
    // Save current metric before going back
    saveStepSilently(drafts[currentMetric?.id ?? ""]);
    if (step > 0) setStep((s) => s - 1);
    else router.push("/style_captain_dashboard/measure/start");
  }

  /** Jump directly to a step. */
  function jumpToStep(idx: number) {
    // Save current metric before jumping
    saveStepSilently(drafts[currentMetric?.id ?? ""]);
    if (idx >= 0 && idx < totalSteps) {
      setStep(idx);
      setPhase("capture");
    }
  }

  /** Save all body measurement drafts, then advance to garment phase. */
  async function saveBodyAndAdvance() {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      const payload = metrics
        .map((m) => drafts[m.id])
        .filter(
          (d) =>
            d &&
            (d.valueNumeric !== null || (d.valueText ?? "").trim() !== ""),
        )
        .map((d) => ({
          measurement_metric_id: d.metricId,
          value_numeric: d.valueNumeric,
          value_text: d.valueText,
          unit: d.unit,
        }));
      if (payload.length > 0) {
        await scSaveMeasurements(job.id, payload);
      }
      setPhase("garment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save readings");
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      await scCompleteJob(job.id, notes, voiceNoteUrl ?? undefined);
      // Reload to pick up the completed status, then show success screen
      await load();
      setPhase("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete job");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Map SCJob data into the admin-api types expected by downloadMeasurementJobPdf,
   * then trigger the same client-side PDF generation used in the admin panel.
   */
  async function handleDownloadPdf(
    scJob: SCJob,
    scMetrics: SCMetric[],
    onProgress?: PdfProgressFn,
  ) {
    if (pdfLoading) return;
    setPdfLoading(true);
    try {
      // Build a minimal MeasurementJobRow
      const pdfJob: MeasurementJobRow = {
        id: scJob.id,
        user_id: scJob.customer_id,
        order_id: scJob.order_id,
        style_captain_id: null,
        status: scJob.status as MeasurementJobRow["status"],
        scheduled_at: scJob.scheduled_at,
        performed_at: scJob.performed_at,
        notes: scJob.notes,
        created_at: scJob.created_at ?? undefined,
        updated_at: undefined,
      };

      // Build a minimal UserRow from SCJob customer fields
      const customer: UserRow | null = scJob.customer_id
        ? {
            id: scJob.customer_id,
            name: scJob.customer_name,
            phone: scJob.customer_phone,
            email: null,
            role: "user",
            gender: null,
            country_code: scJob.customer_country_code,
          }
        : null;

      // Build OrderRow from SCJob order fields
      const order: OrderRow | null = scJob.order_id
        ? {
            id: scJob.order_id,
            user_id: scJob.customer_id,
            address_id: scJob.address_id,
            total_price: null,
            advance_amount: null,
            payment_status: null,
            fulfillment_status: null,
            comments: scJob.order_comments,
            style_captain_id: null,
            order_number: scJob.order_number,
            slot: scJob.slot as OrderRow["slot"],
          }
        : null;

      // Map metrics + measurements into BodyMeasurementWithMetric
      const metricById = new Map(scMetrics.map((m) => [m.id, m]));
      const readingsByMetric = new Map(
        scJob.measurements
          .filter((r) => r.measurement_metric_id)
          .map((r) => [r.measurement_metric_id as string, r]),
      );

      const bodyMeasurements: BodyMeasurementWithMetric[] = scMetrics.map(
        (m): BodyMeasurementWithMetric => {
          const metricRow: MeasurementMetricRow = {
            id: m.id,
            code: m.code,
            slug: m.slug,
            labels: m.labels,
            descriptions: m.descriptions,
            asset_urls: m.asset_urls,
            unit: m.unit,
            priority_order: null,
          };
          const reading = readingsByMetric.get(m.id);
          const readingRow: MeasurementReadingRow | null = reading
            ? {
                id: reading.id,
                measurement_job_id: scJob.id,
                measurement_metric_id: reading.measurement_metric_id,
                value_numeric: reading.value_numeric,
                value_text: reading.value_text,
                unit: reading.unit,
                captured_at: reading.captured_at ?? null,
              }
            : null;
          return { metric: metricRow, reading: readingRow };
        },
      );

      void metricById; // (kept for reference; not strictly needed)

      // Map garment orders + materials
      const garmentMeasurements: GarmentMeasurementGroup[] = scJob.garment_orders.map(
        (go): GarmentMeasurementGroup => ({
          garmentOrderId: go.id,
          garmentId: go.garment_id,
          garmentSlug: go.garment_slug,
          garmentLabels: go.garment_labels,
          status: go.status,
          userNote: go.user_note,
          materials: go.materials.map(
            (mat): GarmentOrderMaterialRow => ({
              id: mat.id,
              garment_order_id: mat.garment_order_id,
              type: mat.type,
              name: mat.name,
              color: mat.color,
              length: mat.length,
              breadth: mat.breadth,
              unit: mat.unit,
              asset_urls: mat.asset_urls,
              comment: mat.comment,
            }),
          ),
        }),
      );

      await downloadMeasurementJobPdf(
        {
          job: pdfJob,
          customer,
          order,
          bodyMeasurements,
          garmentMeasurements,
        },
        onProgress,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setPdfLoading(false);
    }
  }

  // ─── Render guards ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="py-16 text-center text-caption text-muted">
        Loading job…
      </div>
    );
  }

  if (error && !job) {
    return (
      <div className="space-y-3">
        <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
        <button
          onClick={() =>
            router.push("/style_captain_dashboard/measure/start")
          }
          className="tap w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
        >
          Back to job list
        </button>
      </div>
    );
  }

  if (!job) return null;

  const isClosed = job.status === "completed" || job.status === "cancelled";

  return (
    <div className="space-y-4">
      <JobSummaryStrip job={job} />

      {error && (
        <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {phase === "success" ? (
        <SuccessScreen
          job={job}
          metrics={metrics}
          onDownloadPdf={(onProgress) =>
            handleDownloadPdf(job, metrics, onProgress)
          }
          onEdit={() => {
            setStep(0);
            setPhase("capture");
          }}
          onBackToJobs={() => router.push("/style_captain_dashboard")}
        />
      ) : isClosed ? (
        <CompletedView
          job={job}
          metrics={metrics}
          onReload={load}
          onDownloadPdf={(onProgress) =>
            handleDownloadPdf(job, metrics, onProgress)
          }
          onEdit={async () => {
            // Reopen the job: set status back to in_progress
            await scStartJob(job.id);
            // Reload to pick up the new status, then enter capture phase
            await load();
            setStep(0);
            setPhase("capture");
          }}
        />
      ) : phase === "capture" && currentMetric && currentDraft ? (
        <>
          {/* ─── Step indicator (no progress bar) ──────────────────────────── */}
          <div className="flex items-center justify-between text-caption">
            <span className="font-medium text-accent-text">
              Section 1 · Body · Step {step + 1} of {totalSteps}
              {savingStep && (
                <span className="ml-2 text-muted">· saving…</span>
              )}
            </span>
            <button
              onClick={() => {
                saveStepSilently(currentDraft);
                setPhase("checkpoint");
              }}
              className="tap text-muted underline"
            >
              Preview
            </button>
          </div>

          {/* ─── Step jump bar ────────────────────────────────────────────── */}
          <StepJumpBar
            metrics={metrics}
            drafts={drafts}
            currentIdx={step}
            onJump={jumpToStep}
          />

          <MetricCard
            metric={currentMetric}
            draft={currentDraft}
            onChange={updateDraft}
          />

          {/* Input + CTA in sticky footer */}
          <MetricInputBar
            draft={currentDraft}
            onChange={updateDraft}
            isLastStep={step >= totalSteps - 1}
            onBack={prevStep}
            onNext={nextStep}
            onReview={() => {
              saveStepSilently(currentDraft);
              setPhase("checkpoint");
            }}
          />
        </>
      ) : phase === "checkpoint" ? (
        <CheckpointScreen
          metrics={metrics}
          drafts={drafts}
          onEdit={(metricId) => setEditingMetricId(metricId)}
          onJumpToStep={(idx) => {
            setStep(idx);
            setPhase("capture");
          }}
          saving={saving}
          onBack={() => {
            setStep(0);
            setPhase("capture");
          }}
          onContinue={() => saveBodyAndAdvance()}
        />
      ) : phase === "garment" ? (
        <GarmentPhase
          job={job}
          onReload={load}
          onBack={() => setPhase("checkpoint")}
          onContinue={() => setPhase("notes")}
        />
      ) : (
        // phase === "notes"
        <FinalNotesPhase
          notes={notes}
          setNotes={setNotes}
          voiceNoteUrl={voiceNoteUrl}
          onVoiceNoteChange={setVoiceNoteUrl}
          saving={saving}
          onBack={() => setPhase("garment")}
          onComplete={handleComplete}
          job={job}
          metrics={metrics}
          drafts={drafts}
          onEditMetric={(metricId) => setEditingMetricId(metricId)}
          onEditMaterial={(material) => setEditingMaterial(material)}
          onReload={load}
        />
      )}

      {/* ─── Inline edit bottom sheet (checkpoint + notes phase) ────────── */}
      {editingMetricId &&
        metrics.find((m) => m.id === editingMetricId) &&
        drafts[editingMetricId] && (
          <EditMetricSheet
            metric={metrics.find((m) => m.id === editingMetricId)!}
            draft={drafts[editingMetricId]}
            onChange={(next) => {
              updateDraftById(editingMetricId, next);
              saveStepSilently(next);
            }}
            onClose={() => setEditingMetricId(null)}
          />
        )}

      {/* ─── Material edit bottom sheet (notes phase) ───────────────────── */}
      {editingMaterial && (
        <BottomSheet
          title={`Edit · ${editingMaterial.name ?? "Material"}`}
          onClose={() => setEditingMaterial(null)}
        >
          <MaterialForm
            jobId={job.id}
            garmentOrderId={editingMaterial.garment_order_id}
            defaultName={editingMaterial.name ?? "Material"}
            initial={editingMaterial}
            isFirstCloth={false}
            onSubmit={async (input) => {
              await scUpdateMaterial(editingMaterial.id, {
                ...input,
                garment_order_id: editingMaterial.garment_order_id,
              });
              setEditingMaterial(null);
              await load();
            }}
            onCancel={() => setEditingMaterial(null)}
            busy={false}
            canCancel
          />
        </BottomSheet>
      )}
    </div>
  );
}

// ─── Step jump bar ──────────────────────────────────────────────────────────

function StepJumpBar({
  metrics,
  drafts,
  currentIdx,
  onJump,
}: {
  metrics: SCMetric[];
  drafts: Record<string, MetricDraft>;
  currentIdx: number;
  onJump: (idx: number) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {metrics.map((m, idx) => {
        const d = drafts[m.id];
        const isFilled =
          d && (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "");
        const isCurrent = idx === currentIdx;
        return (
          <button
            key={m.id}
            onClick={() => onJump(idx)}
            className={`tap flex h-7 items-center justify-center rounded text-[10px] font-semibold transition ${
              isCurrent
                ? "bg-tape text-chalk-white shadow-card"
                : isFilled
                  ? "bg-success/20 text-success-text"
                  : "bg-mist-navy text-muted"
            }`}
            aria-label={`Step ${idx + 1}: ${m.code}`}
          >
            {isFilled && !isCurrent ? "✓" : idx + 1}
          </button>
        );
      })}
    </div>
  );
}

// ─── Checkpoint screen (Section 1 review) ───────────────────────────────────

function CheckpointScreen({
  metrics,
  drafts,
  onEdit,
  onJumpToStep,
  saving,
  onBack,
  onContinue,
}: {
  metrics: SCMetric[];
  drafts: Record<string, MetricDraft>;
  onEdit: (metricId: string) => void;
  onJumpToStep: (idx: number) => void;
  saving: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [activeLang, setActiveLang] = useState("en");

  // Build list of available languages across all metrics (for the toggle)
  const availableLangs = LANG_ORDER.filter((lang) =>
    metrics.some((m) => (m.labels?.[lang] ?? m.descriptions?.[lang])),
  );
  // Ensure the active language is one of the available ones
  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(activeLang)) {
      setActiveLang(availableLangs[0]);
    }
  }, [availableLangs, activeLang]);

  const filled = metrics
    .map((m, idx) => ({ metric: m, draft: drafts[m.id], idx }))
    .filter(
      (x) =>
        x.draft &&
        (x.draft.valueNumeric !== null || (x.draft.valueText ?? "").trim() !== ""),
    );
  const skipped = metrics.length - filled.length;

  /** Resolve label in the active language, falling back to other languages. */
  function labelFor(metric: SCMetric): string {
    const labels = metric.labels ?? {};
    return (
      labels[activeLang] ??
      labels.en ??
      labels.hi ??
      labels.kn ??
      labels.ta ??
      labels.te ??
      metric.code ??
      "Metric"
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          Section 1 · Checkpoint
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          Body measurements — review
        </h1>
        <p className="mt-1 text-body text-muted">
          {filled.length} of {metrics.length} captured
          {skipped > 0 ? ` · ${skipped} skipped` : ""}
        </p>
      </div>

      {/* ─── Language toggle ──────────────────────────────────────────── */}
      {availableLangs.length > 1 && (
        <div className="flex gap-1 rounded-pill bg-mist-navy p-0.5">
          {availableLangs.map((lang) => {
            const isActive = lang === activeLang;
            return (
              <button
                key={lang}
                onClick={() => setActiveLang(lang)}
                className={`tap flex-1 rounded-pill px-3 py-1.5 text-caption font-semibold uppercase tracking-wide transition ${
                  isActive
                    ? "bg-chalk-white text-ink-navy shadow-card"
                    : "text-muted"
                }`}
              >
                {LANG_TAGS[lang] ?? lang}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Readings summary ──────────────────────────────────────────── */}
      {filled.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-10 text-center">
          <p className="text-body font-medium text-ink-navy">
            No readings captured yet
          </p>
          <p className="mt-1 text-caption text-muted">
            Go back and capture at least one measurement.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          {filled.map(({ metric, draft, idx }) => (
            <li
              key={metric.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <button
                onClick={() => onJumpToStep(idx)}
                className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {/* Serial number */}
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                  {idx + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-ink-navy">
                    {labelFor(metric)}
                  </span>
                  <span className="block truncate text-caption text-muted">
                    {metric.code}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-body font-semibold text-ink">
                  {draft!.valueNumeric !== null
                    ? `${draft!.valueNumeric}${draft!.unit ? ` ${draft!.unit}` : ""}`
                    : draft!.valueText}
                </span>
                <button
                  onClick={() => onEdit(metric.id)}
                  className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ─── Skipped metrics warning ───────────────────────────────────── */}
      {skipped > 0 && (
        <div className="rounded-card border border-error-border bg-error-bg/50 px-4 py-3">
          <p className="text-caption font-medium text-error-text">
            ⚠ {skipped} {skipped === 1 ? "metric is" : "metrics are"} skipped
          </p>
          <p className="mt-0.5 text-[11px] text-error-text/80">
            All body measurements must be captured before continuing to garment
            materials. Tap any skipped metric below to fill it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {metrics.map((m, idx) => {
              const d = drafts[m.id];
              const isFilled =
                d && (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "");
              if (isFilled) return null;
              return (
                <button
                  key={m.id}
                  onClick={() => onJumpToStep(idx)}
                  className="tap rounded-pill border border-error-border bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                >
                  + {labelFor(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Nav ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
          <button
            onClick={onBack}
            disabled={saving}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
          >
            Back
          </button>
          <button
            onClick={onContinue}
            disabled={saving || skipped > 0}
            className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : skipped > 0
                ? "Fill all metrics to continue"
                : "Save & continue to garments →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Final notes phase (post-garment) ───────────────────────────────────────

function FinalNotesPhase({
  notes,
  setNotes,
  voiceNoteUrl,
  onVoiceNoteChange,
  saving,
  onBack,
  onComplete,
  job,
  metrics,
  drafts,
  onEditMetric,
  onEditMaterial,
}: {
  notes: string;
  setNotes: (v: string) => void;
  voiceNoteUrl: string | null;
  onVoiceNoteChange: (url: string | null) => void;
  saving: boolean;
  onBack: () => void;
  onComplete: () => void;
  job: SCJob;
  metrics: SCMetric[];
  drafts: Record<string, MetricDraft>;
  onEditMetric: (metricId: string) => void;
  onEditMaterial: (material: SCGarmentOrderMaterial) => void;
}) {
  // ─── Body measurements for display ────────────────────────────────────────
  const bodyReadings = metrics
    .map((m, idx) => ({ metric: m, draft: drafts[m.id], idx }))
    .filter(
      (x) =>
        x.draft &&
        (x.draft.valueNumeric !== null ||
          (x.draft.valueText ?? "").trim() !== ""),
    );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          Section 2 · Checkpoint
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          Review &amp; finish
        </h1>
        <p className="mt-1 text-body text-muted">
          Review all captured data, add notes, then complete the job.
        </p>
      </div>

      {/* ─── Body measurements review ───────────────────────────────────── */}
      {bodyReadings.length > 0 && (
        <div className="rounded-card border border-hairline bg-chalk-white shadow-card">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <p className="text-eyebrow uppercase tracking-wider text-muted">
              Body · {bodyReadings.length} readings
            </p>
          </div>
          <ul className="divide-y divide-hairline">
            {bodyReadings.map(({ metric, draft, idx }) => (
              <li
                key={metric.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <button
                  onClick={() => onEditMetric(metric.id)}
                  className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                    {idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-ink-navy">
                      {pickLabel(metric.labels, metric.code ?? "Metric")}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {metric.code}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-body font-semibold text-ink">
                    {draft!.valueNumeric !== null
                      ? `${draft!.valueNumeric}${draft!.unit ? ` ${draft!.unit}` : ""}`
                      : draft!.valueText}
                  </span>
                  <button
                    onClick={() => onEditMetric(metric.id)}
                    className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Garment materials review ───────────────────────────────────── */}
      {job.garment_orders.length > 0 && (
        <div className="space-y-3">
          {job.garment_orders.map((go, gIdx) => (
            <div
              key={go.id}
              className="rounded-card border border-hairline bg-chalk-white shadow-card"
            >
              <div className="flex items-center gap-1.5 border-b border-hairline px-4 py-2.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-navy text-[10px] font-bold text-chalk-white">
                  {gIdx + 1}
                </span>
                <p className="text-eyebrow uppercase tracking-wider text-muted">
                  {garmentLabel(go)}
                </p>
              </div>
              {go.materials.length === 0 ? (
                <p className="px-4 py-3 text-caption text-muted">
                  No materials captured.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {go.materials.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <button
                        onClick={() => onEditMaterial(m)}
                        className="tap flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className="inline-block rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-medium uppercase text-ink-navy">
                          {m.type}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-ink-navy">
                            {m.name ?? "—"}
                          </span>
                          <span className="block truncate text-caption text-muted">
                            {m.type === "cloth" && m.length !== null
                              ? `${m.length}×${m.breadth} ${m.unit ?? ""}`.trim()
                              : m.color ?? ""}
                          </span>
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        {m.color && (
                          <span
                            className="inline-block h-4 w-4 rounded-full border border-hairline-strong"
                            style={{ backgroundColor: m.color }}
                          />
                        )}
                        <button
                          onClick={() => onEditMaterial(m)}
                          className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                        >
                          Edit
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Text notes ────────────────────────────────────────────────── */}
      <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <label className="mb-1 block text-caption font-medium text-ink-navy">
          Comment (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="e.g. Customer prefers looser fit. Right shoulder slightly higher."
          className="w-full resize-none rounded-card border border-hairline-strong bg-chalk-white px-4 py-3 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
        />
        <p className="mt-2 text-[11px] text-muted">
          {notes.length}/2000 characters
        </p>
      </div>

      {/* ─── Voice note ────────────────────────────────────────────────── */}
      <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <label className="mb-2 block text-caption font-medium text-ink-navy">
          Voice note (optional)
        </label>
        <VoiceNoteRecorder
          jobId={job.id}
          onUploaded={onVoiceNoteChange}
          uploadedUrl={voiceNoteUrl}
        />
      </div>

      {job.order_comments && (
        <div className="rounded-card bg-warm-sand p-3">
          <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted">
            Existing order comments
          </p>
          <p className="whitespace-pre-wrap text-caption text-ink">
            {job.order_comments}
          </p>
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
          <button
            onClick={onBack}
            disabled={saving}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
          >
            Back
          </button>
          <button
            onClick={onComplete}
            disabled={saving}
            className="tap flex-[2] rounded-pill bg-success px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
          >
            {saving ? "Completing…" : "Complete job ✓"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Job summary strip ─────────────────────────────────────────────────────

function JobSummaryStrip({ job }: { job: SCJob }) {
  return (
    <section className="flex items-center justify-between gap-2 rounded-card border border-hairline bg-chalk-white px-4 py-3 shadow-card">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`inline-flex shrink-0 rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
            job.status,
          )}`}
        >
          {humanStatus(job.status)}
        </span>
        <h2 className="truncate font-heading text-body font-semibold text-ink-navy">
          {job.customer_name ?? "Walk-in customer"}
        </h2>
      </div>
    </section>
  );
}

// ─── Success screen (shown after completing a job) ─────────────────────────

function SuccessScreen({
  job,
  metrics,
  onDownloadPdf,
  onEdit,
  onBackToJobs,
}: {
  job: SCJob;
  metrics: SCMetric[];
  onDownloadPdf: (onProgress?: PdfProgressFn) => Promise<void>;
  onEdit: () => void;
  onBackToJobs: () => void;
}) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);

  async function handleDownload() {
    setPdfLoading(true);
    setPdfProgress("Preparing…");
    try {
      await onDownloadPdf((current, total, label) => {
        if (total > 1) {
          setPdfProgress(`${label} (${current + 1}/${total})`);
        } else {
          setPdfProgress(label);
        }
      });
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
    }
  }

  const customerName = job.customer_name ?? "the customer";
  const measurementsCount = job.measurements.length;
  const garmentCount = job.garment_orders.length;

  return (
    <div className="space-y-5">
      {/* ─── Big green tick ──────────────────────────────────────────────── */}
      <div className="flex flex-col items-center pt-6 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-success/15 ring-8 ring-success/10">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-12 w-12 text-success-text"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="mt-4 font-heading text-h3 font-bold text-ink-navy">
          Job complete!
        </h1>
        <p className="mt-1 max-w-xs text-body text-muted">
          Measurements for{" "}
          <span className="font-semibold text-ink-navy">{customerName}</span>{" "}
          have been saved successfully.
        </p>
      </div>

      {/* ─── Summary stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card border border-hairline bg-chalk-white px-4 py-3 text-center shadow-card">
          <p className="font-heading text-h3 font-bold text-ink-navy">
            {measurementsCount}
          </p>
          <p className="text-caption text-muted">Body measurements</p>
        </div>
        <div className="rounded-card border border-hairline bg-chalk-white px-4 py-3 text-center shadow-card">
          <p className="font-heading text-h3 font-bold text-ink-navy">
            {garmentCount}
          </p>
          <p className="text-caption text-muted">Garments captured</p>
        </div>
      </div>

      {/* ─── Download PDF card ──────────────────────────────────────────── */}
      <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
        <p className="font-heading text-body font-semibold text-ink-navy">
          Download report
        </p>
        <p className="mt-0.5 text-caption text-muted">
          Full measurement report (PDF) with body readings, garment materials,
          and photos.
        </p>
        <button
          onClick={handleDownload}
          disabled={pdfLoading}
          className="tap mt-3 w-full rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white shadow-card disabled:opacity-50"
        >
          {pdfLoading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
              {pdfProgress ?? "Preparing…"}
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </span>
          )}
        </button>
      </div>

      {/* ─── Edit + Back row ─────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <button
          onClick={onEdit}
          disabled={pdfLoading}
          className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
        >
          <span className="flex items-center justify-center gap-1.5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </span>
        </button>
        <button
          onClick={onBackToJobs}
          disabled={pdfLoading}
          className="tap flex-[2] rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
        >
          Back to job list
        </button>
      </div>
    </div>
  );
}

// ─── Completed / cancelled view ────────────────────────────────────────────

function CompletedView({
  job,
  metrics,
  onReload,
  onDownloadPdf,
  onEdit,
}: {
  job: SCJob;
  metrics: SCMetric[];
  onReload: () => void;
  onDownloadPdf: (onProgress?: PdfProgressFn) => Promise<void>;
  onEdit: () => void;
}) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  async function handleDownload() {
    setPdfLoading(true);
    setPdfProgress("Preparing…");
    try {
      await onDownloadPdf((current, total, label) => {
        if (total > 1) {
          setPdfProgress(`${label} (${current + 1}/${total})`);
        } else {
          setPdfProgress(label);
        }
      });
    } finally {
      setPdfLoading(false);
      setPdfProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-success-border bg-success-bg px-4 py-4 text-center">
        <p className="font-heading text-body font-semibold text-success-text">
          This job is {humanStatus(job.status).toLowerCase()}
        </p>
        <p className="mt-1 text-caption text-success-text/80">
          {job.performed_at
            ? `Performed ${new Date(job.performed_at).toLocaleString()}`
            : "No completion date recorded"}
        </p>
      </div>

      {job.notes && (
        <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="mb-1 text-eyebrow uppercase tracking-wider text-muted">
            Notes
          </p>
          <p className="whitespace-pre-wrap text-body text-ink">{job.notes}</p>
        </div>
      )}

      {job.garment_orders.length > 0 && (
        <div className="space-y-3">
          {job.garment_orders.map((go, idx) => (
            <div
              key={go.id}
              className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-navy text-[10px] font-bold text-chalk-white">
                  {idx + 1}
                </span>
                <p className="text-eyebrow uppercase tracking-wider text-muted">
                  {job.garment_orders.length > 1 ? `of ${job.garment_orders.length} · ` : ""}
                  {go.garment_labels
                    ? pickLabel(go.garment_labels, go.garment_slug ?? "Garment")
                    : go.garment_slug ?? "Garment"}
                </p>
              </div>
              {go.materials.length === 0 ? (
                <p className="text-caption text-muted">No materials captured.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {go.materials.map((m) => (
                    <li key={m.id} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-block rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-medium uppercase text-ink-navy">
                            {m.type}
                          </span>
                          <span className="ml-2 text-body font-medium text-ink-navy">
                            {m.name ?? "—"}
                          </span>
                          {m.color && (
                            <span className="ml-2 inline-flex items-center gap-1 align-middle">
                              <span
                                className="inline-block h-3.5 w-3.5 rounded-full border border-hairline-strong"
                                style={{ backgroundColor: m.color }}
                              />
                              <span className="font-mono text-caption text-muted">
                                {m.color}
                              </span>
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 font-mono text-caption text-ink">
                          {m.type === "cloth" && m.length !== null
                            ? `${m.length}×${m.breadth} ${m.unit ?? ""}`.trim()
                            : ""}
                        </span>
                      </div>
                      {m.comment && (
                        <p className="mt-1 text-caption text-muted">
                          {m.comment}
                        </p>
                      )}
                      {m.asset_urls && m.asset_urls.length > 0 && (
                        <div className="mt-2 grid grid-cols-4 gap-1.5">
                          {m.asset_urls.map((url, idx) => (
                            <a
                              key={idx}
                              href={resolveUrl(url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block aspect-square overflow-hidden rounded-card border border-hairline"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={resolveUrl(url)}
                                alt={`${m.name ?? "material"} ${idx + 1}`}
                                className="h-full w-full object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {job.measurements.length > 0 ? (
        <div className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <p className="mb-3 text-eyebrow uppercase tracking-wider text-muted">
            Captured readings
          </p>
          <ul className="divide-y divide-hairline">
            {job.measurements.map((m) => {
              const metric = metrics.find(
                (x) => x.id === m.measurement_metric_id,
              );
              const label = metric
                ? pickLabel(metric.labels, metric.code ?? "Metric")
                : "Unknown metric";
              return (
                <li
                  key={m.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="min-w-0 truncate text-body text-ink">
                    {label}
                  </span>
                  <span className="shrink-0 font-mono text-body font-semibold text-ink-navy">
                    {m.value_numeric !== null
                      ? `${m.value_numeric}${m.unit ? ` ${m.unit}` : ""}`
                      : m.value_text ?? "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center text-caption text-muted">
          No readings were recorded.
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleDownload}
          disabled={pdfLoading || editLoading}
          className="tap flex-1 rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white shadow-card disabled:opacity-50"
        >
          {pdfLoading ? (pdfProgress ?? "Preparing…") : "Download PDF"}
        </button>
        <button
          onClick={async () => {
            setEditLoading(true);
            await onEdit();
            setEditLoading(false);
          }}
          disabled={pdfLoading || editLoading}
          className="tap flex-1 rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-card disabled:opacity-50"
        >
          {editLoading ? "Opening…" : "Edit job"}
        </button>
      </div>
      <button
        onClick={onReload}
        disabled={pdfLoading || editLoading}
        className="tap w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
      >
        Refresh
      </button>
    </div>
  );
}

// ─── Garment phase (Section 2) ──────────────────────────────────────────────

// Same-origin via Next.js proxy (next.config.mjs rewrites). No CORS.
const BE_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? "/api/v1")
  .replace(/\/api\/v\d+$/, "");

function resolveUrl(url: string): string {
  return url.startsWith("http") ? url : `${BE_ORIGIN}${url}`;
}

function garmentLabel(go: SCJob["garment_orders"][number]): string {
  return go.garment_labels
    ? pickLabel(go.garment_labels, go.garment_slug ?? "Garment")
    : go.garment_slug ?? "Garment";
}

function GarmentPhase({
  job,
  onReload,
  onBack,
  onContinue,
}: {
  job: SCJob;
  onReload: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  if (job.garment_orders.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-eyebrow uppercase tracking-wider text-accent-text">
            Section 2 · Garment materials
          </p>
          <h1 className="font-heading text-h4 font-semibold text-ink-navy">
            Cloth &amp; materials
          </h1>
          <p className="mt-1 text-body text-muted">
            No garment instances on this job.
          </p>
        </div>
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-10 text-center">
          <p className="text-body font-medium text-ink-navy">
            {job.order_id
              ? "The order has no garment_orders yet."
              : "This is a walk-in job without a linked order."}
          </p>
        </div>
        <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
            <button
              onClick={onBack}
              className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
            >
              Back
            </button>
            <button
              onClick={onContinue}
              className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
            >
              Continue to review →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const allHaveCloth = job.garment_orders.every(
    (go) => go.materials.some((m) => m.type === "cloth"),
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          Section 2 · Garment materials
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          Cloth &amp; materials
        </h1>
        <p className="mt-1 text-body text-muted">
          Capture at least one cloth piece per garment. The first cloth piece
          name auto-fills with the garment name.
        </p>
      </div>

      <div className="space-y-3">
        {job.garment_orders.map((go, idx) => (
          <GarmentOrderCard
            key={go.id}
            jobId={job.id}
            garmentOrder={go}
            garmentIndex={idx + 1}
            garmentTotal={job.garment_orders.length}
            onReload={onReload}
          />
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 backdrop-blur">
        {allHaveCloth ? (
          <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
            <button
              onClick={onBack}
              className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
            >
              Back
            </button>
            <button
              onClick={onContinue}
              className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
            >
              Continue to review →
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-[480px] space-y-2">
            <p className="text-center text-caption text-muted">
              Add at least one cloth piece for each garment to continue.
            </p>
            <button
              onClick={onBack}
              className="tap w-full rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GarmentOrderCard({
  jobId,
  garmentOrder,
  garmentIndex,
  garmentTotal,
  onReload,
}: {
  jobId: string;
  garmentOrder: SCJob["garment_orders"][number];
  garmentIndex: number;
  garmentTotal: number;
  onReload: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = garmentLabel(garmentOrder);
  const hasCloth = garmentOrder.materials.some((m) => m.type === "cloth");

  const [autoOpened] = useState(() => !hasCloth);
  const showInlineForm = autoOpened && !hasCloth;

  async function handleDelete(materialId: string) {
    if (!confirm("Delete this material row?")) return;
    setBusy(true);
    setError(null);
    try {
      await scDeleteMaterial(materialId);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-navy text-[10px] font-bold text-chalk-white">
              {garmentIndex}
            </span>
            <p className="text-eyebrow uppercase tracking-wider text-muted">
              {garmentTotal > 1 ? `of ${garmentTotal}` : "Garment instance"}
            </p>
          </div>
          <h3 className="mt-0.5 truncate font-heading text-body font-semibold text-ink-navy">
            {label}
          </h3>
        </div>
        {hasCloth && (
          <button
            onClick={() => setSheetOpen(true)}
            className="tap shrink-0 rounded-pill bg-tape px-3 py-1.5 text-caption font-semibold text-chalk-white"
          >
            + Add material
          </button>
        )}
      </header>

      {!hasCloth && (
        <div className="mb-3 rounded-card border border-accent-text/30 bg-warm-sand/50 px-3 py-2 text-[11px] text-accent-text">
          Add at least one cloth piece for this garment to continue.
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-card border border-error-border bg-error-bg px-3 py-2 text-[11px] text-error-text">
          {error}
        </div>
      )}

      {showInlineForm && (
        <div className="mb-3 rounded-card border border-hairline bg-warm-sand/40 p-3">
          <MaterialForm
            jobId={jobId}
            garmentOrderId={garmentOrder.id}
            defaultName={label}
            initial={null}
            isFirstCloth={!hasCloth}
            onSubmit={async (input) => {
              setBusy(true);
              setError(null);
              try {
                await scCreateMaterial({
                  ...input,
                  garment_order_id: garmentOrder.id,
                });
                onReload();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => {}}
            busy={busy}
            canCancel={false}
          />
        </div>
      )}

      {garmentOrder.materials.length === 0 && !showInlineForm ? (
        <p className="text-caption text-muted">
          No materials captured yet for this garment.
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {garmentOrder.materials.map((m) => (
            <MaterialRow
              key={m.id}
              jobId={jobId}
              garmentLabel={label}
              material={m}
              onReload={onReload}
              onDelete={() => handleDelete(m.id)}
              busy={busy}
            />
          ))}
        </ul>
      )}

      {sheetOpen && (
        <BottomSheet
          title={`Add material · ${label}`}
          onClose={() => setSheetOpen(false)}
        >
          <MaterialForm
            jobId={jobId}
            garmentOrderId={garmentOrder.id}
            defaultName={label}
            initial={null}
            isFirstCloth={false}
            onSubmit={async (input) => {
              setBusy(true);
              setError(null);
              try {
                await scCreateMaterial({
                  ...input,
                  garment_order_id: garmentOrder.id,
                });
                setSheetOpen(false);
                onReload();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            onCancel={() => setSheetOpen(false)}
            busy={busy}
            canCancel
          />
        </BottomSheet>
      )}
    </section>
  );
}

function MaterialRow({
  jobId,
  garmentLabel,
  material,
  onReload,
  onDelete,
  busy,
}: {
  jobId: string;
  garmentLabel: string;
  material: SCGarmentOrderMaterial;
  onReload: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);

  return (
    <li className="py-3">
      <MaterialDisplay
        material={material}
        onEdit={() => setEditing(true)}
        onDelete={onDelete}
        disabled={busy}
      />

      {editing && (
        <BottomSheet
          title={`Edit · ${material.name ?? garmentLabel}`}
          onClose={() => setEditing(false)}
        >
          <MaterialForm
            jobId={jobId}
            garmentOrderId={material.garment_order_id}
            defaultName={garmentLabel}
            initial={material}
            isFirstCloth={false}
            onSubmit={async (input) => {
              setLocalBusy(true);
              try {
                await scUpdateMaterial(material.id, {
                  ...input,
                  garment_order_id: material.garment_order_id,
                });
                setEditing(false);
                onReload();
              } catch {
                /* surfaced via form */
              } finally {
                setLocalBusy(false);
              }
            }}
            onCancel={() => setEditing(false)}
            busy={localBusy}
            canCancel
          />
        </BottomSheet>
      )}
    </li>
  );
}

function MaterialDisplay({
  material,
  onEdit,
  onDelete,
  disabled,
}: {
  material: SCGarmentOrderMaterial;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-block rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-medium uppercase text-ink-navy">
            {material.type}
          </span>
          <span className="ml-2 text-body font-medium text-ink-navy">
            {material.name ?? "—"}
          </span>
          {material.color && (
            <span className="ml-2 inline-flex items-center gap-1 align-middle">
              <span
                className="inline-block h-3.5 w-3.5 rounded-full border border-hairline-strong"
                style={{ backgroundColor: material.color }}
              />
              <span className="font-mono text-caption text-muted">
                {material.color}
              </span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={onEdit}
            disabled={disabled}
            className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            disabled={disabled}
            className="tap rounded-pill border border-error-border bg-error-bg px-2.5 py-1 text-[11px] font-medium text-error-text"
          >
            Delete
          </button>
        </div>
      </div>

      {material.type === "cloth" && (material.length !== null || material.breadth !== null) && (
        <p className="mt-0.5 font-mono text-caption text-ink">
          {material.length ?? "—"}×{material.breadth ?? "—"} {material.unit ?? ""}
        </p>
      )}

      {material.comment && (
        <p className="mt-1 text-caption text-muted">{material.comment}</p>
      )}

      {material.asset_urls && material.asset_urls.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {material.asset_urls.map((url, idx) => (
            <a
              key={idx}
              href={resolveUrl(url)}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-card border border-hairline"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveUrl(url)}
                alt={`${material.name ?? "material"} ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inline form for create/edit ────────────────────────────────────────────

function MaterialForm({
  jobId,
  garmentOrderId,
  defaultName,
  initial,
  isFirstCloth,
  onSubmit,
  onCancel,
  busy,
  canCancel,
}: {
  jobId: string;
  garmentOrderId: string;
  defaultName: string;
  initial: SCGarmentOrderMaterial | null;
  isFirstCloth: boolean;
  onSubmit: (input: SCMaterialInput) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
  canCancel: boolean;
}) {
  const [type, setType] = useState<"cloth" | "addon">(initial?.type ?? "cloth");
  const [name, setName] = useState(
    initial?.name ?? (isFirstCloth ? defaultName : ""),
  );
  const [color, setColor] = useState(initial?.color ?? "");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [length, setLength] = useState(
    initial?.length?.toString() ?? "",
  );
  const [breadth, setBreadth] = useState(
    initial?.breadth?.toString() ?? "",
  );
  const [unit, setUnit] = useState<"m" | "in" | "cm">(
    initial?.unit === "in" ? "in" : initial?.unit === "cm" ? "cm" : "m",
  );
  const [assetUrls, setAssetUrls] = useState<string[]>(
    initial?.asset_urls ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleTypeChange(next: "cloth" | "addon") {
    setType(next);
    if (next === "cloth" && name.trim() === "" && isFirstCloth) {
      setName(defaultName);
    }
  }

  async function handleUpload(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setLocalError(null);
    try {
      const results = await scUploadPhotos(jobId, files);
      const urls = results.map((r) =>
        r.url.startsWith("http") ? r.url : resolveUrl(r.url),
      );
      setAssetUrls((prev) => [...prev, ...urls]);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (assetUrls.length === 0) {
      setLocalError("At least one photo is required.");
      return;
    }

    if (!color.trim()) {
      setLocalError("Color is required. Tap to open the camera and capture it.");
      return;
    }

    if (type === "cloth") {
      const len = parseFloat(length);
      const brd = parseFloat(breadth);
      if (isNaN(len) || isNaN(brd)) {
        setLocalError("Cloth materials must have a numeric length and breadth.");
        return;
      }
      const payload: SCMaterialInput = {
        garment_order_id: garmentOrderId,
        type,
        name: name.trim() || null,
        color: color.trim(),
        length: len,
        breadth: brd,
        unit,
        asset_urls: assetUrls,
      };
      void onSubmit(payload);
      return;
    }

    const payload: SCMaterialInput = {
      garment_order_id: garmentOrderId,
      type,
      name: name.trim() || null,
      color: color.trim(),
      asset_urls: assetUrls,
    };
    void onSubmit(payload);
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Type toggle */}
      <div className="flex gap-1 rounded-pill bg-mist-navy p-0.5">
        {(["cloth", "addon"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTypeChange(t)}
            className={`tap flex-1 rounded-pill px-3 py-1.5 text-caption font-semibold capitalize ${
              type === t
                ? "bg-chalk-white text-ink-navy shadow-card"
                : "text-muted"
            }`}
          >
            {t === "cloth" ? "Cloth piece" : "Add-on"}
          </button>
        ))}
      </div>

      {/* Name */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-ink-navy">
          Name{" "}
          {type === "cloth" && isFirstCloth
            ? "(prefilled with garment name)"
            : type === "cloth"
              ? "(e.g. Blouse, Lining, Patti)"
              : "(e.g. Latkan, Hook)"}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "cloth" ? defaultName : "Latkan"}
          className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
        />
      </div>

      {/* Color */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-ink-navy">
          Color <span className="text-error-text">(required)</span>
        </label>
        <button
          type="button"
          onClick={() => setShowColorPicker(true)}
          className={`tap flex w-full items-center gap-3 rounded-card border px-3 py-2.5 text-left ${
            color
              ? "border-hairline-strong bg-chalk-white"
              : "border-dashed border-accent-text/40 bg-warm-sand"
          }`}
        >
          {color ? (
            <>
              <span
                className="h-8 w-8 shrink-0 rounded-card border border-hairline"
                style={{ backgroundColor: color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-body font-semibold text-ink-navy">
                  {color.toUpperCase()}
                </span>
                <span className="block text-[10px] text-muted">
                  Tap to re-capture
                </span>
              </span>
            </>
          ) : (
            <span className="flex w-full items-center justify-center gap-1.5 text-caption font-medium text-accent-text">
              <span className="h-4 w-4 rounded-full border border-accent-text" />
              Open camera to capture color
            </span>
          )}
        </button>
      </div>

      {/* Cloth dimensions */}
      {type === "cloth" && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-navy">
              Length
            </label>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={length}
              onChange={(e) => setLength(e.target.value)}
              placeholder="33"
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-navy">
              Breadth
            </label>
            <input
              type="number"
              step="0.1"
              inputMode="decimal"
              value={breadth}
              onChange={(e) => setBreadth(e.target.value)}
              placeholder="44"
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-navy">
              Unit
            </label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as "m" | "in" | "cm")}
              className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-body text-ink outline-none focus:border-accent-text focus:ring-2 focus:ring-accent-text/30"
            >
              <option value="m">m</option>
              <option value="in">in</option>
              <option value="cm">cm</option>
            </select>
          </div>
        </div>
      )}

      {/* Photos */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-ink-navy">
          Photos <span className="text-error-text">(required)</span>
        </label>
        {assetUrls.length > 0 && (
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            {assetUrls.map((url, idx) => (
              <div
                key={idx}
                className="group relative aspect-square overflow-hidden rounded-card border border-hairline"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveUrl(url)}
                  alt={`Upload ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAssetUrls((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="tap absolute right-0.5 top-0.5 rounded-full bg-ink-navy/80 px-1.5 py-0.5 text-[9px] font-medium text-chalk-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <label
          className={`tap flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-pill border border-dashed px-3 py-2 text-caption font-medium ${
            uploading
              ? "border-hairline-strong bg-mist-navy text-muted"
              : "border-accent-text/40 bg-warm-sand text-accent-text"
          }`}
        >
          {uploading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent-text border-t-transparent" />
              Uploading…
            </>
          ) : (
            <>+ Add photo</>
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) void handleUpload(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {localError && (
        <div className="rounded-card border border-error-border bg-error-bg px-3 py-2 text-[11px] text-error-text">
          {localError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-caption font-medium text-ink-navy"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy}
          className={`tap rounded-pill bg-tape px-3 py-2 text-caption font-semibold text-chalk-white shadow-primary disabled:opacity-50 ${
            canCancel ? "flex-[2]" : "flex-1"
          }`}
        >
          {busy ? "Saving…" : initial ? "Save changes" : "Add material"}
        </button>
      </div>
    </form>

    {showColorPicker && (
      <ColorPickerCamera
        onPick={(pickedHex) => {
          setColor(pickedHex);
          setShowColorPicker(false);
        }}
        onClose={() => setShowColorPicker(false)}
      />
    )}
    </>
  );
}
