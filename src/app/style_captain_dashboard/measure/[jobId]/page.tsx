"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  scAddGarmentToJob,
  scCompleteJob,
  scCreateMaterial,
  scDeleteMaterial,
  scFetchCatalogueGarments,
  scFetchJob,
  scFetchMetrics,
  scSaveMeasurements,
  scStartJob,
  scUpdateMaterial,
  scUploadPhotos,
  scValidateJob,
  type MeasurementPayload,
  type SCGarmentBrief,
  type SCGarmentOrder,
  type SCGarmentOrderMaterial,
  type SCJob,
  type SCMaterialInput,
  type SCMetric,
  type SCChecklist,
  type SCChecklistGarment,
  type SCChecklistMetric,
  type SCChecklistSection,
  type SCSelection,
  type SCValidationError,
  type SCValidationResult,
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
import { GarmentSummaryCard } from "@/components/style-captain/GarmentSummaryCard";
import { SelectionSheet } from "@/components/style-captain/SelectionSheet";
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
// Driven by the entity-derived checklist (base metrics once per visit +
// per-garment sections), with start screens framing each section and one
// validated overall checkpoint at the end:
//   "start" (order overview: garment cards + body metrics needed)
//   Section 1 = Base (body) measurements
//     "capture" → step through base metrics → "checkpoint" (review)
//   Section 2 = Per-garment loop
//     "garment-start" (per-garment gist + editable selections)
//     → "garment-materials" (that garment's cloth/addon materials)
//     → "garment-metrics" (step-through + per-garment review)  ×n
//     → "overall-review" (every garment stacked + THE validation run)
//   → "notes" (final + complete)

type Phase =
  | "start"
  | "capture"
  | "checkpoint"
  | "garment-start"
  | "garment-metrics"
  | "garment-materials"
  | "overall-review"
  | "notes"
  | "success";

/** Draft key helpers — base drafts keyed by metric id, garment drafts
 *  prefixed with the garment order id so one record serves both scopes. */
function baseDraftKey(metricId: string): string {
  return metricId;
}
function garmentDraftKey(garmentOrderId: string, metricId: string): string {
  return `g:${garmentOrderId}:${metricId}`;
}

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
  // Label-resolution catalog for views that render ALL readings (completed /
  // success summaries, PDF): base + every garment section, deduped by id.
  // `metrics` above is base-only and can't resolve garment-scoped readings.
  const [allMetrics, setAllMetrics] = useState<SCMetric[]>([]);
  // Entity-derived checklist — base + per-garment sections (may be empty for
  // unconfigured garments; the captain is never asked what isn't linked).
  const [checklist, setChecklist] = useState<SCChecklist | null>(null);

  const [phase, setPhase] = useState<Phase>("capture");
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, MetricDraft>>({});
  const [notes, setNotes] = useState("");
  const [voiceNoteUrl, setVoiceNoteUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [editingMetricId, setEditingMetricId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<SCGarmentOrderMaterial | null>(null);
  // Selection editing (start screens + step-through section pill) — the
  // garment order whose style selections are being changed, plus the
  // component to scroll the sheet to when entering from a section pill.
  const [editingSelections, setEditingSelections] = useState<{
    garmentOrderId: string;
    focusComponentId?: string | null;
  } | null>(null);
  // Add-garment flow (order start + overall review): pick the garment type,
  // then the edit-selections sheet opens for the new, defaults-seeded row.
  const [addingGarment, setAddingGarment] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Per-garment capture state (Section 2)
  const [activeGarmentIdx, setActiveGarmentIdx] = useState(0);
  const [garmentStep, setGarmentStep] = useState(0);
  // Set when the captain acknowledges warnings — travels with the complete
  // call (server-side gate: block never completes, warn needs the ack).
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  // True when the validation sheet was opened by the completion gate — its
  // acknowledge action should finish the job rather than re-enter capture.
  const [completeAfterAck, setCompleteAfterAck] = useState(false);

  // Validation state — the engine runs only at the garment checkpoint (and
  // re-runs server-side at completion), never after the body capture.
  const [validationResult, setValidationResult] = useState<SCValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [showValidationSheet, setShowValidationSheet] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await scFetchJob(jobId);
      setJob(j);

      // The checklist drives capture: base metrics once per visit, then
      // per-garment sections. Falls back to the flat catalog for legacy
      // jobs without an order/checklist (empty base).
      const cl = j.checklist ?? { base: [], garments: [] };
      setChecklist(cl);
      setMetrics(cl.base);

      // Label-resolution catalog: base + every garment section. If a recorded
      // reading's metric isn't checklisted (legacy jobs measured before the
      // entity reconfiguration), merge in the flat catalog so it still names.
      const labelById = new Map<string, SCMetric>();
      for (const m of cl.base) labelById.set(m.id, m);
      for (const g of cl.garments)
        for (const s of g.sections)
          for (const m of s.metrics) labelById.set(m.id, m);
      const hasOrphan = j.measurements.some(
        (r) =>
          r.measurement_metric_id && !labelById.has(r.measurement_metric_id),
      );
      if (hasOrphan) {
        try {
          for (const m of await scFetchMetrics())
            if (!labelById.has(m.id)) labelById.set(m.id, m);
        } catch {
          // Non-fatal — unresolved readings fall back to "Unknown metric".
        }
      }
      setAllMetrics(Array.from(labelById.values()));

      // Pre-fill base drafts (base readings only — garment_order_id NULL).
      const initial: Record<string, MetricDraft> = {};
      let firstUnfilledIdx = -1;
      let allBaseFilled = true;

      for (let i = 0; i < cl.base.length; i++) {
        const metric = cl.base[i];
        const ex = existingValue(j, metric.id);
        initial[baseDraftKey(metric.id)] = {
          metricId: metric.id,
          valueNumeric: ex.numeric,
          valueText: ex.text,
          unit: ex.unit ?? metric.unit,
        };
        const isFilled =
          ex.numeric !== null || (ex.text ?? "").trim() !== "";
        if (!isFilled) {
          allBaseFilled = false;
          if (firstUnfilledIdx === -1) firstUnfilledIdx = i;
        }
      }

      // Pre-fill per-garment drafts (instance readings).
      const allGarmentMetrics: { goid: string; metric: SCChecklistMetric }[] = [];
      for (const g of cl.garments) {
        for (const s of g.sections) {
          for (const m of s.metrics) {
            allGarmentMetrics.push({ goid: g.garment_order_id, metric: m });
            const ex = existingValue(j, m.id, g.garment_order_id);
            initial[garmentDraftKey(g.garment_order_id, m.id)] = {
              metricId: m.id,
              valueNumeric: ex.numeric,
              valueText: ex.text,
              unit: ex.unit ?? m.unit,
            };
          }
        }
      }
      const allGarmentMetricsFilled = allGarmentMetrics.every((x) => {
        const d = initial[garmentDraftKey(x.goid, x.metric.id)];
        return d && (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "");
      });

      setDrafts(initial);
      setNotes(j.notes ?? "");

      // Smart phase jumping — only on first load; evaluates base + each
      // garment's fill state independently.
      if (!hasInitialized) {
        const hasMeasurements = j.measurements.length > 0;
        const allGarmentsHaveCloth =
          j.garment_orders.length > 0 &&
          j.garment_orders.every((go) =>
            go.materials.some((mat) => mat.type === "cloth"),
          );
        const hasGarmentMetrics = allGarmentMetrics.length > 0;

        if (
          hasMeasurements &&
          allGarmentsHaveCloth &&
          (allGarmentMetricsFilled || !hasGarmentMetrics)
        ) {
          // Everything done — final notes
          setPhase("notes");
        } else if (!hasMeasurements) {
          // Fresh visit — open on the order start screen
          setPhase("start");
        } else if (!allBaseFilled) {
          // Base partially captured — resume at the first unfilled metric
          setStep(Math.max(firstUnfilledIdx, 0));
          setPhase("capture");
        } else {
          // Base done — find the first garment that isn't complete. A garment
          // is complete when its metrics are captured AND cloth is recorded.
          const isGarmentFilled = (goid: string) =>
            allGarmentMetrics
              .filter((x) => x.goid === goid)
              .every((x) => {
                const d = initial[garmentDraftKey(x.goid, x.metric.id)];
                return (
                  d &&
                  (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "")
                );
              });
          const hasCloth = (goid: string) =>
            j.garment_orders.some(
              (go) =>
                go.id === goid &&
                go.materials.some((mat) => mat.type === "cloth"),
            );
          const firstIncompleteIdx = cl.garments.findIndex(
            (g) =>
              !isGarmentFilled(g.garment_order_id) ||
              !hasCloth(g.garment_order_id),
          );
          if (!hasGarmentMetrics || firstIncompleteIdx === -1) {
            // All readings + cloth in — the validated overall review
            setPhase("overall-review");
          } else {
            const goid = cl.garments[firstIncompleteIdx].garment_order_id;
            const clothDone = hasCloth(goid);
            setActiveGarmentIdx(firstIncompleteIdx);
            setGarmentStep(0);
            if (!clothDone) {
              // Cloth not recorded yet — materials come first in this
              // garment's loop (start → materials → metrics).
              setPhase("garment-materials");
            } else {
              const anyFilled = allGarmentMetrics
                .filter((x) => x.goid === goid)
                .some((x) => {
                  const d = initial[garmentDraftKey(x.goid, x.metric.id)];
                  return (
                    d &&
                    (d.valueNumeric !== null ||
                      (d.valueText ?? "").trim() !== "")
                  );
                });
              setPhase(anyFilled ? "garment-metrics" : "garment-start");
            }
          }
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

  // Every checklist metric (base + per-garment), deduped by id — label
  // lookup for validation error chips + the edit sheet.
  const allChecklistMetrics: SCMetric[] = useMemo(() => {
    if (!checklist) return metrics;
    const byId = new Map<string, SCMetric>();
    for (const m of checklist.base) byId.set(m.id, m);
    for (const g of checklist.garments) {
      for (const s of g.sections) {
        for (const m of s.metrics) byId.set(m.id, m);
      }
    }
    return [...byId.values()];
  }, [checklist, metrics]);

  // Display labels per garment instance ("Blouse 1 · Blouse 2" when repeated)
  // + the per-garment selections payload for the edit flow.
  const garmentLabels = useMemo(
    () => garmentLabelMap(checklist?.garments ?? []),
    [checklist],
  );
  const selectionsByGarment = useMemo(() => {
    const out: Record<string, SCSelection[]> = {};
    for (const go of job?.garment_orders ?? []) {
      if (go.selections && go.selections.length > 0) out[go.id] = go.selections;
    }
    return out;
  }, [job]);

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
   * Pass garmentOrderId for an instance reading; omit for a base reading.
   */
  function saveStepSilently(
    draft: MetricDraft | undefined,
    garmentOrderId?: string,
  ) {
    if (!job || !draft) return;
    const hasValue =
      draft.valueNumeric !== null || (draft.valueText ?? "").trim() !== "";
    if (!hasValue) return;
    setSavingStep(true);
    scSaveMeasurements(job.id, [
      {
        measurement_metric_id: draft.metricId,
        garment_order_id: garmentOrderId ?? null,
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

  /** Order start CTA — enter body capture (straight through to the garment
   *  flow when the order asks for no base metrics). */
  function beginBody() {
    if (metrics.length === 0) {
      void saveBodyAndAdvance();
      return;
    }
    setStep(0);
    setPhase("capture");
  }

  /** Save all base measurement drafts and move on to Section 2 — each
   *  garment opens on its start screen. No validation here; the engine runs
   *  once at the overall review so every finding, base- and garment-scoped
   *  alike, surfaces in one go. */
  async function saveBodyAndAdvance() {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      const payload = metrics
        .map((m) => drafts[baseDraftKey(m.id)])
        .filter(
          (d) =>
            d &&
            (d.valueNumeric !== null || (d.valueText ?? "").trim() !== ""),
        )
        .map((d) => ({
          measurement_metric_id: d.metricId,
          garment_order_id: null,
          value_numeric: d.valueNumeric,
          value_text: d.valueText,
          unit: d.unit,
        }));
      if (payload.length > 0) {
        await scSaveMeasurements(job.id, payload);
      }
      // Section 2 opens on the first garment's start screen (skipped
      // entirely when the order has no garment instances).
      if ((checklist?.garments ?? []).length > 0) {
        setActiveGarmentIdx(0);
        setGarmentStep(0);
        setPhase("garment-start");
      } else {
        setPhase("overall-review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save readings");
    } finally {
      setSaving(false);
    }
  }

  /** Re-run validation (called after the user remeasures a metric inside the
   *  validation bottom sheet). Updates the result in place so the sheet
   *  refreshes. */
  async function revalidate() {
    if (!job) return;
    setValidating(true);
    try {
      const result = await scValidateJob(job.id);
      setValidationResult(result);
      if (result.status === "pass") {
        setShowValidationSheet(false);
        // Stay put — the completion-gate sheet keeps the captain on notes to
        // re-tap complete, and the overall review unlocks its own Continue.
      }
    } catch {
      /* best-effort */
    } finally {
      setValidating(false);
    }
  }

  /** Called after the user acknowledges non-critical warnings in the sheet. */
  function proceedAfterWarningAck() {
    setShowValidationSheet(false);
    setWarningsAcknowledged(true);
    // When the ack came from the completion gate, finish the job instead of
    // restarting garment capture (e.g. after a mid-visit page reload).
    if (completeAfterAck) {
      setCompleteAfterAck(false);
      // Pass the ack explicitly: the handleComplete closure still sees the
      // pre-setState value of warningsAcknowledged in this tick.
      void handleComplete(true);
      return;
    }
    setPhase("notes");
  }

  /** Persist every filled per-garment draft, then close THIS garment's loop
   *  (start → materials → metrics): the next garment opens on its start
   *  screen, and after the last one the validated overall review takes over. */
  async function saveGarmentsAndAdvance() {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      // Bulk-save all filled garment-instance drafts (deduped per
      // garment+metric — a metric can surface in more than one section).
      const byKey = new Map<string, MeasurementPayload>();
      for (const g of checklist?.garments ?? []) {
        for (const s of g.sections) {
          for (const m of s.metrics) {
            const d = drafts[garmentDraftKey(g.garment_order_id, m.id)];
            if (!d) continue;
            const hasValue =
              d.valueNumeric !== null || (d.valueText ?? "").trim() !== "";
            if (!hasValue) continue;
            byKey.set(`${g.garment_order_id}:${m.id}`, {
              measurement_metric_id: d.metricId,
              garment_order_id: g.garment_order_id,
              value_numeric: d.valueNumeric,
              value_text: d.valueText,
              unit: d.unit,
            });
          }
        }
      }
      if (byKey.size > 0) {
        await scSaveMeasurements(job.id, [...byKey.values()]);
      }
      const garments = checklist?.garments ?? [];
      if (activeGarmentIdx < garments.length - 1) {
        setActiveGarmentIdx(activeGarmentIdx + 1);
        setGarmentStep(0);
        setPhase("garment-start");
      } else {
        setPhase("overall-review");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save readings");
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(ackWarnings?: boolean) {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      await scCompleteJob(
        job.id,
        notes,
        voiceNoteUrl ?? undefined,
        ackWarnings ?? warningsAcknowledged,
      );
      // Reload to pick up the completed status, then show success screen
      await load();
      setPhase("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete job";
      // Server-side gate: warn needs acknowledgement. Rather than dead-ending
      // on the raw API message (e.g. after a page reload reset the ack state),
      // surface the validation sheet so the captain can verify and acknowledge.
      if (/acknowledge/i.test(message)) {
        try {
          const result = await scValidateJob(job.id);
          setValidationResult(result);
          setCompleteAfterAck(true);
          setShowValidationSheet(true);
          return;
        } catch {
          /* fall through to the generic error below */
        }
      }
      setError(message);
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
        started_at: scJob.started_at,
        performed_at: scJob.performed_at,
        completed_at: scJob.completed_at,
        notes: scJob.notes,
        created_at: scJob.created_at ?? undefined,
        updated_at: scJob.updated_at ?? undefined,
      };

      // Build a minimal UserRow from SCJob customer fields
      const customer: UserRow | null = scJob.customer_id
        ? {
            id: scJob.customer_id,
            name: scJob.customer_name,
            phone: scJob.customer_phone,
            email: null,
            roles: ["customer"],
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
            order_number: scJob.order_number,
            slot: scJob.slot as OrderRow["slot"],
            // Carry the recorded voice note so the PDF includes the QR + link.
            voice_note_asset_url: voiceNoteUrl,
          }
        : null;

      // Map metrics + measurements: BASE readings only (garment_order_id
      // NULL) for the body pages — per-garment readings render on their own
      // garment's page (doc §10: base section + one section per garment).
      // Legacy jobs (no order → empty checklist) have no base list at all;
      // fall back to the full priority-ordered catalog. Rows without a
      // captured base reading are dropped later, so only real readings
      // render body pages.
      const baseMetricList: SCMetric[] =
        checklist?.base && checklist.base.length > 0 ? checklist.base : scMetrics;
      const metricRowById = new Map<string, MeasurementMetricRow>();
      const toMetricRow = (m: SCMetric): MeasurementMetricRow => {
        const existing = metricRowById.get(m.id);
        if (existing) return existing;
        const row: MeasurementMetricRow = {
          id: m.id,
          code: m.code,
          slug: m.slug,
          labels: m.labels,
          descriptions: m.descriptions,
          asset_urls: m.asset_urls,
          unit: m.unit,
          priority_order: null,
        };
        metricRowById.set(m.id, row);
        return row;
      };
      const toReadingRow = (r: SCJob["measurements"][number]): MeasurementReadingRow => ({
        id: r.id,
        measurement_job_id: scJob.id,
        measurement_metric_id: r.measurement_metric_id,
        garment_order_id: r.garment_order_id ?? null,
        value_numeric: r.value_numeric,
        value_text: r.value_text,
        unit: r.unit,
        captured_at: r.captured_at ?? null,
      });

      const baseReadings = new Map(
        scJob.measurements
          .filter((r) => r.measurement_metric_id && !r.garment_order_id)
          .map((r) => [r.measurement_metric_id as string, r]),
      );
      const garmentReadingsByGo = new Map<string, SCJob["measurements"][number][]>();
      for (const r of scJob.measurements) {
        if (r.measurement_metric_id && r.garment_order_id) {
          const list = garmentReadingsByGo.get(r.garment_order_id) ?? [];
          list.push(r);
          garmentReadingsByGo.set(r.garment_order_id, list);
        }
      }

      const bodyMeasurements: BodyMeasurementWithMetric[] = baseMetricList.map(
        (m) => ({
          metric: toMetricRow(m),
          reading: baseReadings.has(m.id)
            ? toReadingRow(baseReadings.get(m.id)!)
            : null,
        }),
      );

      // Map garment orders + materials (+ this instance's own readings)
      const garmentMeasurements: GarmentMeasurementGroup[] = scJob.garment_orders.map(
        (go): GarmentMeasurementGroup => {
          const cl_garment = checklist?.garments.find(
            (x) => x.garment_order_id === go.id,
          );
          // Seed with the full label catalog so readings whose metric isn't
          // in this garment's sections (legacy captures) still resolve.
          const cl_metrics = new Map<string, SCMetric>(
            scMetrics.map((m) => [m.id, m]),
          );
          for (const s of cl_garment?.sections ?? []) {
            for (const m of s.metrics) cl_metrics.set(m.id, m);
          }
          // The API returns readings captured_at-DESC; restore the
          // checklist's section order (the priority order the wizard
          // captures in). Legacy readings outside the sections keep their
          // relative order at the end.
          const sectionRank = new Map<string, number>();
          let ri = 0;
          for (const s of cl_garment?.sections ?? []) {
            for (const m of s.metrics) sectionRank.set(m.id, ri++);
          }
          const sectionRankOf = (mid: string | null) =>
            mid !== null
              ? (sectionRank.get(mid) ?? Number.MAX_SAFE_INTEGER)
              : Number.MAX_SAFE_INTEGER;
          const goReadings = [...(garmentReadingsByGo.get(go.id) ?? [])].sort(
            (a, b) =>
              sectionRankOf(a.measurement_metric_id) -
              sectionRankOf(b.measurement_metric_id),
          );
          const readings: BodyMeasurementWithMetric[] = goReadings.map((r) => ({
            metric: cl_metrics.get(r.measurement_metric_id as string)
              ? toMetricRow(cl_metrics.get(r.measurement_metric_id as string)!)
              : toMetricRow({ id: r.measurement_metric_id as string, code: null, slug: null, labels: null, descriptions: null, asset_urls: null, unit: r.unit }),
            reading: toReadingRow(r),
          }));
          return {
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
            readings,
          };
        },
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

  // Active garment's checklist entry + job payload row (start screen phase).
  const activeClGarment = checklist?.garments[activeGarmentIdx] ?? null;
  const activeGarmentOrder =
    job.garment_orders.find((g) => g.id === activeClGarment?.garment_order_id) ??
    null;

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
          metrics={allMetrics}
          onDownloadPdf={(onProgress) =>
            handleDownloadPdf(job, allMetrics, onProgress)
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
          metrics={allMetrics}
          checklist={checklist}
          onReload={load}
          onDownloadPdf={(onProgress) =>
            handleDownloadPdf(job, allMetrics, onProgress)
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
      ) : phase === "start" ? (
        <JobStartScreen
          job={job}
          metrics={metrics}
          labels={garmentLabels}
          onAddGarment={() => setAddingGarment(true)}
          onStart={beginBody}
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
            requiredBy={(
              (currentMetric as SCChecklistMetric).required_by ?? []
            ).map((r) => ({
              garment: garmentLabels[r.garment_order_id] ?? "this order",
              entities: r.entity_labels ?? [],
            }))}
          />

          {/* Input + CTA in sticky footer */}
          <MetricInputBar
            draft={currentDraft}
            onChange={updateDraft}
            isLastStep={step >= totalSteps - 1}
            onBack={prevStep}
            onNext={nextStep}
            onReview={async () => {
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
      ) : phase === "garment-start" ? (
        activeClGarment && activeGarmentOrder ? (
          <GarmentStartScreen
            label={garmentLabels[activeClGarment.garment_order_id] ?? activeClGarment.label}
            garmentOrder={activeGarmentOrder}
            sections={activeClGarment.sections}
            garmentPosition={activeGarmentIdx + 1}
            garmentCount={checklist?.garments.length ?? 1}
            onEditSelections={() =>
              setEditingSelections({
                garmentOrderId: activeClGarment.garment_order_id,
              })
            }
            onStart={() => {
              setGarmentStep(0);
              setPhase("garment-materials");
            }}
            onBack={() => {
              // Walk back into the previous garment's metrics review, or
              // the body checkpoint when this is the first garment.
              if (activeGarmentIdx > 0) {
                setActiveGarmentIdx(activeGarmentIdx - 1);
                setPhase("garment-metrics");
              } else {
                setPhase("checkpoint");
              }
            }}
          />
        ) : (
          <div className="py-8 text-center text-caption text-muted">
            Garment not found.
          </div>
        )
      ) : phase === "garment-metrics" ? (
        <GarmentMetricsStage
          checklist={checklist}
          drafts={drafts}
          activeGarmentIdx={activeGarmentIdx}
          garmentStep={garmentStep}
          savingStep={savingStep}
          submitting={saving || validating}
          selectionsByGarment={selectionsByGarment}
          onActiveGarmentChange={(idx) => {
            setGarmentStep(0);
            setActiveGarmentIdx(idx);
          }}
          onGarmentStepChange={setGarmentStep}
          onUpdateDraft={updateDraftById}
          onSaveSilently={saveStepSilently}
          onEditMetric={(draftKey) => setEditingMetricId(draftKey)}
          onEditSelections={(garmentOrderId, focusComponentId) =>
            setEditingSelections({ garmentOrderId, focusComponentId })
          }
          onBack={() => setPhase("garment-materials")}
          onContinue={saveGarmentsAndAdvance}
        />
      ) : phase === "overall-review" ? (
        <OverallReviewScreen
          garments={checklist?.garments ?? []}
          drafts={drafts}
          labels={garmentLabels}
          result={validationResult}
          validating={validating}
          warningsAcknowledged={warningsAcknowledged}
          onValidate={revalidate}
          onOpenValidation={() => setShowValidationSheet(true)}
          onEditMetric={(draftKey) => setEditingMetricId(draftKey)}
          onJumpToGarment={(idx, stepIdx) => {
            setActiveGarmentIdx(idx);
            setGarmentStep(stepIdx);
            setPhase("garment-metrics");
          }}
          onAddGarment={() => setAddingGarment(true)}
          onBack={() => {
            // Back into the last garment's metrics.
            const lastIdx = Math.max((checklist?.garments.length ?? 1) - 1, 0);
            setActiveGarmentIdx(lastIdx);
            setPhase("garment-metrics");
          }}
          onContinue={() => setPhase("notes")}
        />
      ) : phase === "garment-materials" ? (
        <GarmentMaterialsPhase
          job={job}
          activeGarmentIdx={activeGarmentIdx}
          onReload={load}
          onBack={() => setPhase("garment-start")}
          onContinue={() => setPhase("garment-metrics")}
        />
      ) : (
        // phase === "notes"
        <FinalNotesPhase
          notes={notes}
          setNotes={setNotes}
          voiceNoteUrl={voiceNoteUrl}
          onVoiceNoteChange={setVoiceNoteUrl}
          saving={saving}
          onBack={() => setPhase("overall-review")}
          onComplete={() => void handleComplete()}
          job={job}
          metrics={metrics}
          drafts={drafts}
          onEditMetric={(metricId) => setEditingMetricId(metricId)}
          onEditMaterial={(material) => setEditingMaterial(material)}
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

      {/* ─── Validation bottom sheet (critical + non-critical) ─────────── */}
      {showValidationSheet && validationResult && job && (
        <ValidationSheet
          result={validationResult}
          validating={validating}
          metrics={allChecklistMetrics}
          drafts={drafts}
          checklist={checklist}
          garmentLabels={garmentLabelMap(checklist?.garments ?? [])}
          onRemeasure={(draftKey) => setEditingMetricId(draftKey)}
          onRevalidate={revalidate}
          onAcknowledgeWarnings={proceedAfterWarningAck}
          onClose={() => setShowValidationSheet(false)}
        />
      )}

      {/* ─── Add-garment bottom sheet (order start + overall review) ──── */}
      {addingGarment && job && (
        <AddGarmentSheet
          onClose={() => setAddingGarment(false)}
          onPick={async (garmentId) => {
            try {
              const res = await scAddGarmentToJob(job.id, garmentId);
              setAddingGarment(false);
              // Re-derive job + checklist so the new garment's sections,
              // drafts and review rows exist, then land in the edit
              // selections sheet for the freshly seeded instance.
              await load();
              setEditingSelections({ garmentOrderId: res.garment_order_id });
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Failed to add garment",
              );
            }
          }}
        />
      )}

      {/* ─── Selection edit bottom sheet (start screens + section pill) ── */}
      {editingSelections && job && (() => {
        const go = job.garment_orders.find(
          (g) => g.id === editingSelections.garmentOrderId,
        );
        const sels = go?.selections ?? [];
        if (sels.length === 0) return null;
        const clGarment = checklist?.garments.find(
          (g) => g.garment_order_id === editingSelections.garmentOrderId,
        );
        const baseline = clGarment
          ? flattenGarmentSections(clGarment).map((s) => s.metric.id)
          : [];
        return (
          <SelectionSheet
            jobId={job.id}
            garmentOrderId={editingSelections.garmentOrderId}
            selections={sels}
            availableAddons={go?.available_addons ?? []}
            baselineMetricIds={baseline}
            focusComponentId={editingSelections.focusComponentId}
            onClose={() => setEditingSelections(null)}
            onDone={async () => {
              setEditingSelections(null);
              // Re-derive the checklist + drafts; phase/step state survives
              // the reload (smart jump only runs on the first load).
              await load();
            }}
          />
        );
      })()}

      {/* ─── Inline edit bottom sheet (checkpoint + notes phase) ──────────
          Rendered LAST so it stacks above the ValidationSheet when opened
          from within it (both are fixed inset-0; DOM order wins).
          Keys are base metric ids or `g:{garmentOrderId}:{metricId}`. */}
      {editingMetricId &&
        (() => {
          let metric: SCMetric | null = null;
          let garmentOrderId: string | undefined;
          if (editingMetricId.startsWith("g:")) {
            const parts = editingMetricId.split(":");
            garmentOrderId = parts[1];
            metric = findChecklistMetric(checklist, parts[2]);
          } else {
            metric = metrics.find((m) => m.id === editingMetricId) ?? null;
          }
          const draft = drafts[editingMetricId];
          if (!metric || !draft) return null;
          const gLabels = garmentLabelMap(checklist?.garments ?? []);
          return (
            <EditMetricSheet
              metric={metric}
              draft={draft}
              garmentLabel={
                garmentOrderId ? gLabels[garmentOrderId] : undefined
              }
              onChange={(next) => {
                updateDraftById(editingMetricId, next);
                saveStepSilently(next, garmentOrderId);
              }}
              onClose={() => {
                setEditingMetricId(null);
                // Re-run validation after an edit when its verdict is on
                // screen (the sheet, or the overall review beneath it).
                if (showValidationSheet || phase === "overall-review") {
                  revalidate();
                }
              }}
            />
          );
        })()}
    </div>
  );
}

// ─── Checklist helpers ───────────────────────────────────────────────────────

/** Find a metric anywhere in the checklist (base or garment sections). */
function findChecklistMetric(
  checklist: SCChecklist | null,
  metricId: string | undefined,
): SCMetric | null {
  if (!checklist || !metricId) return null;
  for (const m of checklist.base) {
    if (m.id === metricId) return m;
  }
  for (const g of checklist.garments) {
    for (const s of g.sections) {
      for (const m of s.metrics) {
        if (m.id === metricId) return m;
      }
    }
  }
  return null;
}

/** Flatten a garment's sections into an ordered step list with section context. */
function flattenGarmentSections(
  garment: SCChecklistGarment,
): {
  metric: SCChecklistMetric;
  sectionLabel: string;
  entity: SCChecklistSection["entity"];
}[] {
  const out: {
    metric: SCChecklistMetric;
    sectionLabel: string;
    entity: SCChecklistSection["entity"];
  }[] = [];
  for (const s of garment.sections) {
    for (const m of s.metrics) {
      out.push({ metric: m, sectionLabel: s.entity.label, entity: s.entity });
    }
  }
  return out;
}

/** Order captured readings to match the wizard's checklist order (base
 *  metrics first, then each garment's section metrics). Readings outside
 *  the checklist — legacy jobs measured before it existed, or orphans —
 *  fall back to the priority-ordered flat catalog; anything still
 *  unmatched keeps its relative order at the end. */
function orderMeasurementsByChecklist(
  measurements: SCJob["measurements"],
  checklist: SCChecklist | null,
  fallbackMetrics: SCMetric[] = [],
): SCJob["measurements"] {
  const rank = new Map<string, number>();
  let i = 0;
  const base = "b";
  if (checklist) {
    for (const m of checklist.base) rank.set(`${base}:${m.id}`, i++);
    for (const g of checklist.garments) {
      for (const s of g.sections) {
        for (const m of s.metrics) {
          rank.set(`${g.garment_order_id}:${m.id}`, i++);
        }
      }
    }
  }
  // The flat catalog is priority-ordered (same ordering the checklist
  // resolver uses); it covers legacy jobs whose checklist is empty.
  for (const m of fallbackMetrics) {
    if (!rank.has(`${base}:${m.id}`)) rank.set(`${base}:${m.id}`, i++);
  }
  if (rank.size === 0) return measurements;
  const at = (m: SCJob["measurements"][number]) =>
    rank.get(`${m.garment_order_id ?? base}:${m.measurement_metric_id}`) ??
    Number.MAX_SAFE_INTEGER;
  return [...measurements].sort((a, b) => at(a) - at(b));
}

/** Display labels per garment instance — repeated garments get numbered
 *  ("Blouse", "Blouse 2") so garment-scoped metrics can name their garment
 *  in the validation sheet and the edit sheet. */
function garmentLabelMap(
  garments: SCChecklistGarment[],
): Record<string, string> {
  const counts = new Map<string, number>();
  for (const g of garments) counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const g of garments) {
    const nth = (seen.get(g.label) ?? 0) + 1;
    seen.set(g.label, nth);
    out[g.garment_order_id] =
      (counts.get(g.label) ?? 1) > 1 ? `${g.label} ${nth}` : g.label;
  }
  return out;
}

// ─── Garment metrics stage (Section 2 · per-instance capture) ────────────────

function GarmentMetricsStage({
  checklist,
  drafts,
  activeGarmentIdx,
  garmentStep,
  savingStep,
  submitting,
  selectionsByGarment,
  onActiveGarmentChange,
  onGarmentStepChange,
  onUpdateDraft,
  onSaveSilently,
  onEditMetric,
  onEditSelections,
  onBack,
  onContinue,
}: {
  checklist: SCChecklist | null;
  drafts: Record<string, MetricDraft>;
  activeGarmentIdx: number;
  garmentStep: number;
  savingStep: boolean;
  submitting: boolean;
  selectionsByGarment: Record<string, SCSelection[]>;
  onActiveGarmentChange: (idx: number) => void;
  onGarmentStepChange: (idx: number) => void;
  onUpdateDraft: (draftKey: string, next: MetricDraft) => void;
  onSaveSilently: (draft: MetricDraft | undefined, garmentOrderId?: string) => void;
  onEditMetric: (draftKey: string) => void;
  onEditSelections: (garmentOrderId: string, focusComponentId?: string | null) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  // Label per garment instance ("Blouse 1 · Blouse 2" when repeated)
  const garments = checklist?.garments ?? [];
  const gLabels = garmentLabelMap(garments);
  const displayLabels = garments.map((g) => gLabels[g.garment_order_id]);

  const active: SCChecklistGarment | null = garments[activeGarmentIdx] ?? null;
  const steps = active ? flattenGarmentSections(active) : [];
  const clampedStep = Math.min(garmentStep, Math.max(steps.length - 1, 0));
  const current = steps[clampedStep] ?? null;
  const currentKey = current
    ? garmentDraftKey(active!.garment_order_id, current.metric.id)
    : "";
  const currentDraft = current ? drafts[currentKey] : null;

  const isFilled = (d: MetricDraft | undefined) =>
    !!d && (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "");

  // Review-mode state: -1 = stepping; otherwise reviewing garment i
  const [reviewing, setReviewing] = useState(false);

  // Per-garment progress (filled / total + required gate)
  const garmentStats = garments.map((g) => {
    const all = flattenGarmentSections(g);
    const filled = all.filter((s) =>
      isFilled(drafts[garmentDraftKey(g.garment_order_id, s.metric.id)]),
    );
    const missingRequired = all.filter(
      (s) =>
        s.metric.is_required &&
        !isFilled(drafts[garmentDraftKey(g.garment_order_id, s.metric.id)]),
    );
    return { garment: g, total: all.length, filled: filled.length, missingRequired };
  });

  const activeStats = garmentStats[activeGarmentIdx];
  void activeStats; // progress is surfaced via the tabs + review screen

  // Nothing garment-specific to capture — go straight through.
  if (garments.length === 0 || garmentStats.every((s) => s.total === 0)) {
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-hairline-strong bg-chalk-white px-4 py-3">
          <p className="text-body font-semibold text-ink-navy">
            Garment measurements
          </p>
          <p className="mt-1 text-caption text-muted">
            No garment-specific metrics for this order — nothing to capture
            for this garment.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
          >
            ← Back
          </button>
          <button
            onClick={onContinue}
            disabled={submitting}
            className="tap flex-1 rounded-pill bg-ink-navy px-4 py-3 text-body font-semibold text-chalk-white disabled:opacity-60"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                Saving…
              </span>
            ) : (
              "Continue →"
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Per-garment tabs */}
      {garments.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {garments.map((g, i) => {
            const stats = garmentStats[i];
            const done = stats.missingRequired.length === 0 && stats.filled === stats.total;
            return (
              <button
                key={g.garment_order_id}
                onClick={() => {
                  setReviewing(false);
                  onActiveGarmentChange(i);
                }}
                className={`tap rounded-pill px-3 py-1.5 text-caption font-medium transition ${
                  i === activeGarmentIdx
                    ? "bg-ink-navy text-chalk-white shadow-card"
                    : done
                      ? "bg-success/20 text-success-text"
                      : "bg-mist-navy text-muted"
                }`}
              >
                {done && i !== activeGarmentIdx ? "✓ " : ""}
                {displayLabels[i]} · {stats.filled}/{stats.total}
              </button>
            );
          })}
        </div>
      )}

      {reviewing && active ? (
        /* ── Review list for the active garment ── */
        <GarmentMetricsReview
          garment={active}
          label={displayLabels[activeGarmentIdx]}
          drafts={drafts}
          checking={submitting}
          onEdit={(draftKey) => onEditMetric(draftKey)}
          onJumpToStep={(idx) => {
            setReviewing(false);
            onGarmentStepChange(idx);
          }}
          onBack={() => setReviewing(false)}
          onContinue={onContinue}
          isLastGarment={activeGarmentIdx >= garments.length - 1}
        />
      ) : current && currentDraft && active ? (
        /* ── Step-through for the active garment ── */
        <>
          <div className="flex items-center justify-between text-caption">
            <span className="font-medium text-accent-text">
              Section 2 · {displayLabels[activeGarmentIdx]} · Step{" "}
              {clampedStep + 1} of {steps.length}
              {savingStep && <span className="ml-2 text-muted">· saving…</span>}
            </span>
            <button
              onClick={() => {
                onSaveSilently(currentDraft, active.garment_order_id);
                setReviewing(true);
              }}
              className="tap text-muted underline"
            >
              Preview
            </button>
          </div>

          {/* Section context — which entity asked for this metric.
              Variation sections double as the inline edit affordance:
              tapping opens the selection sheet focused on that component. */}
          {(() => {
            const editable = (
              selectionsByGarment[active.garment_order_id] ?? []
            ).find(
              (sel) =>
                sel.type === "variation" &&
                (sel.variation?.id === current.entity.id ||
                  sel.variation_type?.id === current.entity.id),
            );
            if (editable) {
              return (
                <button
                  onClick={() =>
                    onEditSelections(
                      active.garment_order_id,
                      editable.component?.id ?? null,
                    )
                  }
                  className="tap inline-flex w-fit items-center gap-1.5 rounded-pill bg-mist-navy px-3 py-1 text-[11px] font-medium text-ink-navy"
                >
                  {current.sectionLabel}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
              );
            }
            return (
              <div className="rounded-pill bg-mist-navy px-3 py-1 text-[11px] font-medium text-muted inline-block w-fit">
                {current.sectionLabel}
              </div>
            );
          })()}

          <StepJumpBar
            metrics={steps.map((s) => s.metric)}
            drafts={drafts}
            currentIdx={clampedStep}
            onJump={(idx) => onGarmentStepChange(idx)}
          />

          <MetricCard
            metric={current.metric}
            draft={currentDraft}
            onChange={(next) => onUpdateDraft(currentKey, next)}
          />

          <MetricInputBar
            draft={currentDraft}
            onChange={(next) => onUpdateDraft(currentKey, next)}
            isLastStep={clampedStep >= steps.length - 1}
            onBack={() => {
              onSaveSilently(currentDraft, active.garment_order_id);
              if (clampedStep > 0) onGarmentStepChange(clampedStep - 1);
              else onBack();
            }}
            onNext={() => {
              onSaveSilently(currentDraft, active.garment_order_id);
              if (clampedStep < steps.length - 1) {
                onGarmentStepChange(clampedStep + 1);
              } else {
                setReviewing(true);
              }
            }}
            onReview={() => {
              onSaveSilently(currentDraft, active.garment_order_id);
              setReviewing(true);
            }}
          />
        </>
      ) : (
        <div className="py-8 text-center text-caption text-muted">
          {active
            ? `All ${displayLabels[activeGarmentIdx] ?? ""} metrics captured.`
            : "No garment metrics."}
        </div>
      )}
    </div>
  );
}

/** Review list for ONE garment's captured metrics (filled + missing). */
function GarmentMetricsReview({
  garment,
  label,
  drafts,
  checking,
  onEdit,
  onJumpToStep,
  onBack,
  onContinue,
  isLastGarment,
}: {
  garment: SCChecklistGarment;
  label: string;
  drafts: Record<string, MetricDraft>;
  checking: boolean;
  onEdit: (draftKey: string) => void;
  onJumpToStep: (idx: number) => void;
  onBack: () => void;
  onContinue: () => void;
  isLastGarment: boolean;
}) {
  const [activeLang, setActiveLang] = useState("en");
  const steps = flattenGarmentSections(garment);

  // Build list of available languages across this garment's metrics (for
  // the toggle) — same mechanics as the body checkpoint.
  const availableLangs = LANG_ORDER.filter((lang) =>
    steps.some((s) => s.metric.labels?.[lang] ?? s.metric.descriptions?.[lang]),
  );
  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(activeLang)) {
      setActiveLang(availableLangs[0]);
    }
  }, [availableLangs, activeLang]);

  const filled = steps
    .map((step, idx) => ({
      step,
      idx,
      draft: drafts[garmentDraftKey(garment.garment_order_id, step.metric.id)],
    }))
    .filter(
      (x) =>
        x.draft &&
        (x.draft.valueNumeric !== null || (x.draft.valueText ?? "").trim() !== ""),
    );
  const skipped = steps.length - filled.length;
  const missingRequired = steps.filter(
    (s) =>
      s.metric.is_required &&
      !drafts[garmentDraftKey(garment.garment_order_id, s.metric.id)],
  );

  /** Resolve label in the active language, falling back to other languages. */
  function labelFor(metric: SCChecklistMetric): string {
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
          Section 2 · {label}
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          {label} measurements — review
        </h1>
        <p className="mt-1 text-body text-muted">
          {filled.length} of {steps.length} captured
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
            Go back and capture at least one measurement for this garment.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          {filled.map(({ step, draft, idx }) => {
            const key = garmentDraftKey(garment.garment_order_id, step.metric.id);
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  onClick={() => onJumpToStep(idx)}
                  className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                    {idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-ink-navy">
                      {labelFor(step.metric)}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {step.metric.code}
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
                    onClick={() => onEdit(key)}
                    className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                  >
                    Edit
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ─── Missing required metrics warning ─────────────────────────── */}
      {missingRequired.length > 0 && (
        <div className="rounded-card border border-error-border bg-error-bg/50 px-4 py-3">
          <p className="text-caption font-medium text-error-text">
            ⚠ {missingRequired.length} required{" "}
            {missingRequired.length === 1 ? "metric is" : "metrics are"} missing
          </p>
          <p className="mt-0.5 text-[11px] text-error-text/80">
            All {label.toLowerCase()} measurements must be captured before
            continuing. Tap a metric below to fill it.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingRequired.map((s) => (
              <button
                key={s.metric.id}
                onClick={() => onJumpToStep(steps.indexOf(s))}
                className="tap rounded-pill border border-error-border bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy"
              >
                + {labelFor(s.metric)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Nav ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-column items-center justify-between gap-3">
          <button
            onClick={onBack}
            disabled={checking}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={onContinue}
            disabled={missingRequired.length > 0 || checking}
            className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
          >
            {checking ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                Saving…
              </span>
            ) : missingRequired.length > 0 ? (
              "Fill required metrics"
            ) : isLastGarment ? (
              "Continue → final review"
            ) : (
              "Next garment →"
            )}
          </button>
        </div>
      </div>
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

// ─── Order start screen (phase "start") ─────────────────────────────────────

/** The visit's opening screen: one summary card per garment (images, gist,
 *  language chips, speak button) + the list of body measurements the visit
 *  will need, so the captain knows the full scope before measuring. */
function JobStartScreen({
  job,
  metrics,
  labels,
  onAddGarment,
  onStart,
}: {
  job: SCJob;
  metrics: SCMetric[];
  labels: Record<string, string>;
  onAddGarment: () => void;
  onStart: () => void;
}) {
  const [activeLang, setActiveLang] = useState("en");

  const availableLangs = LANG_ORDER.filter((lang) =>
    metrics.some((m) => m.labels?.[lang] ?? m.descriptions?.[lang]),
  );
  useEffect(() => {
    if (availableLangs.length > 0 && !availableLangs.includes(activeLang)) {
      setActiveLang(availableLangs[0]);
    }
  }, [availableLangs, activeLang]);

  function labelFor(metric: SCMetric): string {
    const l = metric.labels ?? {};
    return (
      l[activeLang] ?? l.en ?? l.hi ?? l.kn ?? l.ta ?? l.te ?? metric.code ?? "Metric"
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          Order overview
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          {job.customer_name ?? "Walk-in customer"}
        </h1>
        <p className="mt-1 text-body text-muted">
          {job.garment_orders.length}{" "}
          {job.garment_orders.length === 1 ? "garment" : "garments"} ·{" "}
          {metrics.length} body{" "}
          {metrics.length === 1 ? "measurement" : "measurements"} needed
        </p>
      </div>

      {/* ─── One card per garment instance ──────────────────────────────── */}
      {job.garment_orders.map((go) => (
        <GarmentSummaryCard
          key={go.id}
          label={labels[go.id] ?? pickLabel(go.garment_labels, go.garment_slug ?? "Garment")}
          garmentOrder={go}
        />
      ))}

      {/* Mid-visit garment add — same sheet flow as edit selections. */}
      <button
        onClick={onAddGarment}
        className="tap flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-4 py-3 text-caption font-medium text-ink-navy"
      >
        + Add garment
      </button>

      {/* ─── Body measurements needed ───────────────────────────────────── */}
      {metrics.length > 0 && (
        <section className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card">
          <div className="border-b border-hairline px-4 py-3">
            <p className="text-eyebrow uppercase tracking-wider text-accent-text">
              Body measurements needed
            </p>
          </div>
          {availableLangs.length > 1 && (
            <div className="px-4 pt-3">
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
            </div>
          )}
          <ul className="divide-y divide-hairline">
            {metrics.map((m, idx) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                    {idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-ink-navy">
                      {labelFor(m)}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      {m.code}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Nav ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto max-w-column">
          <button
            onClick={onStart}
            className="tap w-full rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
          >
            {metrics.length === 0 ? "Continue →" : "Start body measurements →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add-garment sheet (order start + overall review) ───────────────────────

/** First step of the mid-visit garment add: pick the catalog garment type.
 *  On pick, the parent creates the garment order (defaults seeded by the
 *  backend) and opens the edit-selections sheet for it. */
function AddGarmentSheet({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (garmentId: string) => void;
}) {
  const [garments, setGarments] = useState<SCGarmentBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    scFetchCatalogueGarments()
      .then((rows) => {
        if (!cancelled) setGarments(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load garments");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BottomSheet title="Add garment" onClose={onClose}>
      <div className="space-y-2">
        {error && (
          <div className="rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
            {error}
          </div>
        )}
        {garments === null && !error && (
          <p className="px-1 py-4 text-center text-caption text-muted">
            Loading garments…
          </p>
        )}
        {garments?.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              if (addingId) return;
              setAddingId(g.id);
              onPick(g.id);
            }}
            disabled={addingId !== null}
            className="tap flex w-full items-center justify-between gap-3 rounded-card border border-hairline bg-chalk-white px-4 py-3 text-left disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 text-body font-medium text-ink-navy">
              {pickLabel(g.labels, g.slug ?? "Garment")}
            </span>
            <span className="text-caption text-muted">
              {addingId === g.id ? "Adding…" : "＋"}
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}

// ─── Per-garment start screen (phase "garment-start") ───────────────────────

/** The gist card for ONE garment + its editable selections + the grouped
 *  list of measurements this instance will need. */
function GarmentStartScreen({
  label,
  garmentOrder,
  sections,
  garmentPosition,
  garmentCount,
  onEditSelections,
  onStart,
  onBack,
}: {
  label: string;
  garmentOrder: SCGarmentOrder;
  sections: SCChecklistSection[];
  garmentPosition: number;
  garmentCount: number;
  onEditSelections: () => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const metricCount = sections.reduce((n, s) => n + s.metrics.length, 0);

  return (
    <div className="space-y-4">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          {garmentCount > 1
            ? `Garment ${garmentPosition} of ${garmentCount}`
            : "Garment"}
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          {label}
        </h1>
        <p className="mt-1 text-body text-muted">
          {metricCount > 0
            ? `${metricCount} ${metricCount === 1 ? "measurement" : "measurements"} to take`
            : "No garment-specific measurements"}
        </p>
      </div>

      {/* ─── Gist card + edit entry ────────────────────────────────────── */}
      <GarmentSummaryCard label={label} garmentOrder={garmentOrder} />

      {(garmentOrder.selections?.length ?? 0) > 0 && (
        <button
          onClick={onEditSelections}
          className="tap inline-flex items-center gap-2 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
          Edit selections
        </button>
      )}

      {/* ─── Measurements we'll take, grouped by source section ────────── */}
      {sections.length > 0 ? (
        sections.map((s) => (
          <section
            key={`${s.entity.type}-${s.entity.id}`}
            className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card"
          >
            <p className="bg-mist-navy/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {s.entity.label}
            </p>
            <ul className="divide-y divide-hairline">
              {s.metrics.map((m, idx) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                      {idx + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-body font-medium text-ink-navy">
                        {pickLabel(m.labels, m.code ?? "")}
                      </span>
                      <span className="block truncate text-caption text-muted">
                        {m.code}
                      </span>
                    </span>
                  </span>
                  {m.is_required && (
                    <span className="shrink-0 rounded-pill bg-mist-navy px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-navy">
                      REQ
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
          <p className="text-body font-medium text-ink-navy">
            No measurements for this garment
          </p>
          <p className="mt-1 text-caption text-muted">
            Capture the cloth &amp; materials, then continue.
          </p>
        </div>
      )}

      {/* ─── Nav ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-column items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy"
          >
            Back
          </button>
          <button
            onClick={onStart}
            className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
          >
            Cloth &amp; materials →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Overall review (phase "overall-review") ────────────────────────────────

/** Every garment's readings stacked in one place, with THE validation run:
 *  the engine fires on mount (and after edits) — pass unlocks Continue,
 *  advisories are acknowledged in the existing ValidationSheet, criticals
 *  must be fixed before completion. */
function OverallReviewScreen({
  garments,
  drafts,
  labels,
  result,
  validating,
  warningsAcknowledged,
  onValidate,
  onOpenValidation,
  onEditMetric,
  onJumpToGarment,
  onAddGarment,
  onBack,
  onContinue,
}: {
  garments: SCChecklistGarment[];
  drafts: Record<string, MetricDraft>;
  labels: Record<string, string>;
  result: SCValidationResult | null;
  validating: boolean;
  warningsAcknowledged: boolean;
  onValidate: () => void;
  onOpenValidation: () => void;
  onEditMetric: (draftKey: string) => void;
  onJumpToGarment: (garmentIdx: number, stepIdx: number) => void;
  onAddGarment: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const validatedOnce = useRef(false);

  const isFilled = (d: MetricDraft | undefined) =>
    !!d && (d.valueNumeric !== null || (d.valueText ?? "").trim() !== "");

  // The engine's single wizard run — once per mount into this screen.
  useEffect(() => {
    if (validatedOnce.current) return;
    validatedOnce.current = true;
    onValidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalMetrics = garments.reduce(
    (n, g) => n + flattenGarmentSections(g).length,
    0,
  );
  const totalFilled = garments.reduce(
    (n, g) =>
      n +
      flattenGarmentSections(g).filter((s) =>
        isFilled(drafts[garmentDraftKey(g.garment_order_id, s.metric.id)]),
      ).length,
    0,
  );

  const status = result?.status ?? null;
  const canContinue =
    !validating &&
    (status === "pass" || (status === "warn" && warningsAcknowledged));

  const verdict = validating && !result ? (
    <div className="flex items-center gap-3 rounded-card border border-hairline bg-chalk-white px-4 py-3 shadow-card">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-text border-t-transparent" />
      <p className="text-caption font-medium text-muted">
        Checking measurements…
      </p>
    </div>
  ) : status === "pass" ? (
    <div className="flex items-center gap-3 rounded-card border border-success-border bg-success-bg px-4 py-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-success text-[12px] font-bold text-chalk-white">
        ✓
      </span>
      <p className="text-caption font-medium text-success-text">
        All measurements pass validation
      </p>
    </div>
  ) : status === "warn" ? (
    <div className="flex items-center gap-3 rounded-card border border-warning-border bg-warning-bg px-4 py-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-warning text-[12px] font-bold text-chalk-white">
        ?
      </span>
      <p className="min-w-0 flex-1 text-caption font-medium text-warning-text">
        {result!.non_critical_errors.length}{" "}
        {result!.non_critical_errors.length === 1 ? "advisory" : "advisories"}{" "}
        to review
        {warningsAcknowledged ? " · acknowledged" : ""}
      </p>
      <button
        onClick={onOpenValidation}
        className="tap shrink-0 rounded-pill bg-tape px-3 py-1.5 text-[12px] font-semibold text-chalk-white shadow-primary"
      >
        {warningsAcknowledged ? "View advisories" : "Review advisories →"}
      </button>
    </div>
  ) : status === "block" ? (
    <div className="flex items-center gap-3 rounded-card border border-error-border bg-error-bg px-4 py-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-error text-[12px] font-bold text-chalk-white">
        !
      </span>
      <p className="min-w-0 flex-1 text-caption font-medium text-error-text">
        {result!.critical_errors.length} critical{" "}
        {result!.critical_errors.length === 1 ? "issue" : "issues"} — fix
        before continuing
      </p>
      <button
        onClick={onOpenValidation}
        className="tap shrink-0 rounded-pill bg-ink-navy px-3 py-1.5 text-[12px] font-semibold text-chalk-white"
      >
        View issues →
      </button>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-eyebrow uppercase tracking-wider text-accent-text">
          Final checkpoint
        </p>
        <h1 className="font-heading text-h4 font-semibold text-ink-navy">
          All garments — review
        </h1>
        <p className="mt-1 text-body text-muted">
          {totalFilled} of {totalMetrics} garment readings captured
        </p>
      </div>

      {/* ─── Validation verdict ────────────────────────────────────────── */}
      {verdict}

      {/* ─── Per-garment reading lists ─────────────────────────────────── */}
      {garments.length === 0 ? (
        <div className="rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-6 py-8 text-center">
          <p className="text-body font-medium text-ink-navy">
            No garment measurements for this order
          </p>
        </div>
      ) : (
        garments.map((g, gi) => {
          const steps = flattenGarmentSections(g);
          const filled = steps
            .map((step, idx) => ({
              step,
              idx,
              draft: drafts[garmentDraftKey(g.garment_order_id, step.metric.id)],
            }))
            .filter((x) => isFilled(x.draft));
          const missingRequired = steps.filter(
            (s) =>
              s.metric.is_required &&
              !isFilled(drafts[garmentDraftKey(g.garment_order_id, s.metric.id)]),
          );
          return (
            <section
              key={g.garment_order_id}
              className="overflow-hidden rounded-card border border-hairline bg-chalk-white shadow-card"
            >
              <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
                <p className="text-eyebrow uppercase tracking-wider text-accent-text">
                  {labels[g.garment_order_id] ?? g.label}
                </p>
                <span className="text-caption text-muted">
                  {filled.length}/{steps.length}
                </span>
              </div>
              {filled.length === 0 ? (
                <p className="px-4 py-3 text-caption text-muted">
                  No readings captured yet.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {filled.map(({ step, draft, idx }) => {
                    const key = garmentDraftKey(
                      g.garment_order_id,
                      step.metric.id,
                    );
                    return (
                      <li
                        key={key}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <button
                          onClick={() => onJumpToGarment(gi, idx)}
                          className="tap flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mist-navy text-[10px] font-bold text-ink-navy">
                            {idx + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-body font-medium text-ink-navy">
                              {pickLabel(step.metric.labels, step.metric.code ?? "")}
                            </span>
                            <span className="block truncate text-caption text-muted">
                              {step.sectionLabel}
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
                            onClick={() => onEditMetric(key)}
                            className="tap rounded-pill bg-mist-navy px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                          >
                            Edit
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {missingRequired.length > 0 && (
                <div className="border-t border-hairline bg-error-bg/50 px-4 py-3">
                  <p className="text-caption font-medium text-error-text">
                    ⚠ {missingRequired.length} required{" "}
                    {missingRequired.length === 1 ? "metric is" : "metrics are"}{" "}
                    missing
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {missingRequired.map((s) => (
                      <button
                        key={s.metric.id}
                        onClick={() => onJumpToGarment(gi, steps.indexOf(s))}
                        className="tap rounded-pill border border-error-border bg-chalk-white px-2.5 py-1 text-[11px] font-medium text-ink-navy"
                      >
                        + {pickLabel(s.metric.labels, s.metric.code ?? "")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })
      )}

      {/* Mid-visit garment add — same sheet flow as edit selections. */}
      <button
        onClick={onAddGarment}
        className="tap flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-hairline-strong bg-chalk-white/50 px-4 py-3 text-caption font-medium text-ink-navy"
      >
        + Add garment
      </button>

      {/* ─── Nav ───────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-column items-center justify-between gap-3">
          <button
            onClick={onBack}
            disabled={validating}
            className="tap flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-4 py-3 text-body font-medium text-ink-navy disabled:opacity-50"
          >
            Back
          </button>
          {status === "warn" && !warningsAcknowledged ? (
            <button
              onClick={onOpenValidation}
              className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
            >
              Review advisories →
            </button>
          ) : (
            <button
              onClick={onContinue}
              disabled={!canContinue}
              className="tap flex-[2] rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-50"
            >
              {validating && status !== "pass"
                ? "Checking…"
                : status === "block"
                  ? "Fix critical issues"
                  : "Continue → notes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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
      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-column items-center justify-between gap-3">
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
                : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Validation bottom sheet (critical + non-critical + remeasure) ──────────

/** Map a validation error's values keys (snake_case metric names) to the
 *  matching SCMetric objects so we can show "Re-measure" buttons.
 *  e.g. "upper_bust" → metric with slug "upper-bust" */
function findMetricsForError(
  error: SCValidationError,
  metrics: SCMetric[],
): SCMetric[] {
  const result: SCMetric[] = [];
  if (!error.values) return result;
  for (const key of Object.keys(error.values)) {
    // Validation keys are snake_case ("upper_bust").
    // Metric slugs are kebab-case ("upper-bust"), codes are snake_case ("upper_bust").
    const kebab = key.replace(/_/g, "-");
    const m = metrics.find(
      (mt) =>
        mt.slug === kebab ||            // slug match (kebab)
        mt.code === key ||              // exact code match (snake_case)
        mt.code?.toLowerCase() === key, // case-insensitive code match
    );
    if (m && !result.find((r) => r.id === m.id)) result.push(m);
  }
  return result;
}

/** Resolve the draft a validation chip should open: garment instances are
 *  keyed `g:{garmentOrderId}:{metricId}`, base readings `b:{metricId}`.
 *  When several instances carry the same metric, prefer the one whose value
 *  matches the engine's snapshot (`error.values`) — that's the instance the
 *  rule actually fired on. */
function draftKeyForErrorMetric(
  checklist: SCChecklist | null,
  drafts: Record<string, MetricDraft>,
  metricId: string,
  error?: SCValidationError,
): { key: string; draft: MetricDraft | undefined } {
  const code = findChecklistMetric(checklist, metricId)?.code;
  const snapshotValue =
    error?.values && code ? error.values[code] : undefined;

  const garmentKeys: string[] = [];
  for (const g of checklist?.garments ?? []) {
    const has = g.sections.some((s) =>
      s.metrics.some((m) => m.id === metricId),
    );
    if (has) garmentKeys.push(garmentDraftKey(g.garment_order_id, metricId));
  }
  const candidates = [
    ...garmentKeys.map((k) => ({ key: k, draft: drafts[k] })),
    { key: baseDraftKey(metricId), draft: drafts[baseDraftKey(metricId)] },
  ];

  const filled = candidates.filter(
    (c) => c.draft && (c.draft.valueNumeric !== null || (c.draft.valueText ?? "").trim() !== ""),
  );
  const bySnapshot =
    typeof snapshotValue === "number"
      ? filled.find((c) => c.draft?.valueNumeric === snapshotValue)
      : undefined;
  const chosen = bySnapshot ?? filled[0] ?? candidates[0];
  return { key: chosen.key, draft: chosen.draft };
}

function ValidationSheet({
  result,
  validating,
  metrics,
  drafts,
  checklist,
  garmentLabels,
  onRemeasure,
  onRevalidate,
  onAcknowledgeWarnings,
  onClose,
}: {
  result: SCValidationResult;
  validating: boolean;
  metrics: SCMetric[];
  drafts: Record<string, MetricDraft>;
  checklist: SCChecklist | null;
  garmentLabels: Record<string, string>;
  onRemeasure: (draftKey: string) => void;
  onRevalidate: () => void;
  onAcknowledgeWarnings: () => void;
  onClose: () => void;
}) {
  const [verifiedSet, setVerifiedSet] = useState<Set<string>>(new Set());
  const [activeLang, setActiveLang] = useState<string>("en");

  // Detect available languages from explanation objects
  const availableLangs = useMemo(() => {
    const allErrs = [...result.critical_errors, ...result.non_critical_errors];
    const langSet = new Set<string>(["en"]);
    for (const e of allErrs) {
      if (e.explanation) {
        for (const lang of Object.keys(e.explanation)) {
          if (e.explanation[lang]) langSet.add(lang);
        }
      }
    }
    return LANG_ORDER.filter((l) => langSet.has(l));
  }, [result]);

  const hasCritical = result.critical_errors.length > 0;
  const hasWarnings = result.non_critical_errors.length > 0;
  const allWarningsVerified =
    hasWarnings &&
    result.non_critical_errors.every((err) => verifiedSet.has(`${err.rule}-${err.code}`));

  function toggleVerify(key: string) {
    setVerifiedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-navy/40 backdrop-blur-[1px]"
      />
      <div className="relative flex max-h-[90dvh] w-full max-w-column flex-col rounded-t-sheet bg-chalk-white shadow-brand animate-slide-up">
        {/* Drag handle */}
        <div className="flex items-center justify-center pt-3 pb-1">
          <span className="h-1 w-10 rounded-pill bg-tape-silver" />
        </div>

        {/* ── Header ── */}
        <div className="shrink-0 px-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-accent-text">
                Checkpoint
              </span>
              <h2 className="font-heading text-h2 text-ink-navy">
                {hasCritical ? "Measurement check" : "Advisories"}
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mist-navy text-ink-navy"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
          {/* Count badges */}
          <div className="mt-2 flex flex-wrap gap-2">
            {hasCritical && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-error-bg px-2.5 py-1 text-[12px] font-semibold text-error-text">
                <span className="h-1.5 w-1.5 rounded-full bg-error" />
                {result.critical_errors.length} critical
              </span>
            )}
            {hasWarnings && (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-warning-border bg-warning-bg px-2.5 py-1 text-[12px] font-semibold text-warning-text">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                {result.non_critical_errors.length} advisories
              </span>
            )}
            {hasWarnings && !hasCritical && (
              <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                {verifiedSet.size}/{result.non_critical_errors.length} verified
              </span>
            )}
          </div>

          {/* Language toggle */}
          {availableLangs.length > 1 && (
            <div className="mt-2 flex gap-1 rounded-pill bg-mist-navy p-0.5">
              {availableLangs.map((lang) => {
                const isActive = lang === activeLang;
                return (
                  <button
                    key={lang}
                    onClick={() => setActiveLang(lang)}
                    className={`tap flex-1 rounded-pill px-3 py-1 text-caption font-semibold uppercase tracking-wide transition ${
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
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {validating && (
            <div className="flex items-center justify-center gap-2 py-6">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-text border-t-transparent" />
              <span className="text-body text-muted">Re-checking…</span>
            </div>
          )}
          <div className="space-y-2.5 pb-4">
            {hasCritical && result.critical_errors.map((err, idx) => (
              <ValidationItem key={`c-${idx}`} error={err} critical metrics={metrics} drafts={drafts} checklist={checklist} garmentLabels={garmentLabels} onRemeasure={onRemeasure} lang={activeLang} />
            ))}
            {hasCritical && hasWarnings && (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-hairline" />
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Advisories</span>
                <span className="h-px flex-1 bg-hairline" />
              </div>
            )}
            {hasWarnings && result.non_critical_errors.map((err, idx) => {
              const vKey = `${err.rule}-${err.code}`;
              return (
                <ValidationItem
                  key={`w-${idx}`}
                  error={err}
                  metrics={metrics}
                  drafts={drafts}
                  checklist={checklist}
                  garmentLabels={garmentLabels}
                  onRemeasure={onRemeasure}
                  verified={verifiedSet.has(vKey)}
                  onVerify={() => toggleVerify(vKey)}
                  lang={activeLang}
                />
              );
            })}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 border-t border-hairline bg-chalk-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {hasCritical ? (
            <div className="flex items-center justify-center gap-2.5">
              <button
                onClick={onRevalidate}
                disabled={validating}
                aria-label="Re-check"
                className="tap flex h-10 w-10 items-center justify-center rounded-full border border-hairline-strong bg-chalk-white text-ink-navy disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${validating ? "animate-spin" : ""}`}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></svg>
              </button>
              <p className="text-[13px] text-muted">
                Fix the critical issues, then re-check
              </p>
            </div>
          ) : (
            <button
              onClick={onAcknowledgeWarnings}
              disabled={!allWarningsVerified}
              className="tap w-full rounded-pill bg-tape px-6 py-3 text-body font-semibold text-chalk-white shadow-primary disabled:opacity-40"
            >
              {allWarningsVerified ? "Continue →" : `Verify all (${verifiedSet.size}/${result.non_critical_errors.length})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Validation card — uses Banner pattern: left-stripe accent + icon badge */
function ValidationItem({
  error,
  critical,
  metrics,
  drafts,
  checklist,
  garmentLabels,
  onRemeasure,
  verified,
  onVerify,
  lang = "en",
}: {
  error: SCValidationError;
  critical?: boolean;
  metrics: SCMetric[];
  drafts: Record<string, MetricDraft>;
  checklist: SCChecklist | null;
  garmentLabels: Record<string, string>;
  onRemeasure: (draftKey: string) => void;
  verified?: boolean;
  onVerify?: () => void;
  lang?: string;
}) {
  const explanation = error.explanation?.[lang] ?? error.explanation?.en ?? error.rule;
  const relatedMetrics = findMetricsForError(error, metrics);

  const accent = verified ? "var(--success)" : critical ? "var(--error)" : "var(--warning)";
  const bg = verified ? "bg-success-bg" : critical ? "bg-error-bg" : "bg-[color-mix(in_srgb,var(--warning)_12%,white)]";
  const iconChar = verified ? "✓" : critical ? "!" : "?";

  return (
    <div
      className={`flex items-start gap-3 rounded-card border border-hairline px-3 py-2.5 ${bg}`}
      style={{ borderLeft: `1.5px solid ${accent}` }}
    >
      {/* Icon badge — Banner pattern */}
      <span
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-pill text-[12px] font-bold text-chalk-white"
        style={{ background: accent }}
      >
        {iconChar}
      </span>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Explanation text */}
        <p className="text-[14px] leading-relaxed text-ink">
          {explanation}
        </p>

        {/* Rule code + measurement chips */}
        {!verified && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
              {error.code}
            </span>
          </div>
        )}

        {/* Measurement chips + Verified on the right */}
        {!verified && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {/* Readable measurement chips: "Shoulder Left  1.0" */}
            {relatedMetrics.map((m) => {
              const { key: dKey, draft: d } = draftKeyForErrorMetric(
                checklist,
                drafts,
                m.id,
                error,
              );
              const val = d
                ? d.valueNumeric !== null
                  ? `${d.valueNumeric}${d.unit === "in" ? '"' : d.unit ?? ""}`
                  : d.valueText ?? "—"
                : "—";
              const label = pickLabel(m.labels, m.code ?? "");
              // Garment-scoped drafts carry their instance in the key — name
              // it on the chip so "Blouse 1 patti" is distinguishable from
              // "Blouse 2 patti" when the same rule fires on both.
              const goId = dKey.startsWith("g:")
                ? dKey.split(":")[1]
                : undefined;
              const garment = goId ? garmentLabels[goId] : undefined;
              return (
                <button
                  key={m.id}
                  onClick={() => onRemeasure(dKey)}
                  className="tap inline-flex items-center gap-1.5 rounded-pill border border-hairline-strong bg-chalk-white px-2.5 py-1 text-[12px] text-ink-navy"
                  aria-label={`Edit ${garment ? `${garment} ` : ""}${label}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 flex-none text-accent-text"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></svg>
                  <span className="text-muted">{label}</span>
                  {garment && (
                    <span className="rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] font-semibold text-ink-navy">
                      {garment}
                    </span>
                  )}
                  <span className="font-mono font-semibold text-ink">{val}</span>
                </button>
              );
            })}

            {/* Verified CTA pushed to the right for quick thumb access */}
            {!critical && onVerify && (
              <button
                onClick={onVerify}
                className="tap ml-auto inline-flex items-center gap-1 rounded-pill bg-tape px-3 py-1 text-[12px] font-semibold text-chalk-white shadow-primary"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><polyline points="20 6 9 17 4 12" /></svg>
                Verified
              </button>
            )}
          </div>
        )}
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

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        <div className="mx-auto flex max-w-column items-center justify-between gap-3">
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
  checklist,
  onReload,
  onDownloadPdf,
  onEdit,
}: {
  job: SCJob;
  metrics: SCMetric[];
  checklist: SCChecklist | null;
  onReload: () => void;
  onDownloadPdf: (onProgress?: PdfProgressFn) => Promise<void>;
  onEdit: () => void;
}) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  // Checklist priority order (base first, then garment sections) — the
  // same order the wizard captures in.
  const orderedReadings = orderMeasurementsByChecklist(
    job.measurements,
    checklist,
    metrics,
  );

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
        <div className="mt-1 space-y-0.5 text-caption text-success-text/80">
          {job.scheduled_at && (
            <p>Scheduled {new Date(job.scheduled_at).toLocaleString()}</p>
          )}
          {job.started_at && (
            <p>Started {new Date(job.started_at).toLocaleString()}</p>
          )}
          {job.completed_at && (
            <p>Completed {new Date(job.completed_at).toLocaleString()}</p>
          )}
          {!job.scheduled_at && !job.started_at && !job.completed_at && (
            <p>No timestamps recorded</p>
          )}
        </div>
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
            {orderedReadings.map((m) => {
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

// ─── Garment materials phase (Section 2, per garment) ───────────────────────

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

/** Cloth & materials for ONE garment — the step right after that garment's
 *  start screen and before its metrics. Continue moves to this garment's
 *  metric capture. */
function GarmentMaterialsPhase({
  job,
  activeGarmentIdx,
  onReload,
  onBack,
  onContinue,
}: {
  job: SCJob;
  activeGarmentIdx: number;
  onReload: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const active = job.garment_orders[activeGarmentIdx];

  if (!active) {
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
            No garment instance at this position.
          </p>
        </div>
        <button
          onClick={onContinue}
          className="tap w-full rounded-pill bg-tape px-4 py-3 text-body font-semibold text-chalk-white shadow-primary"
        >
          Continue to metrics →
        </button>
      </div>
    );
  }

  const hasCloth = active.materials.some((m) => m.type === "cloth");

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
          Garment {activeGarmentIdx + 1} of {job.garment_orders.length} ·{" "}
          {garmentLabel(active)} — capture at least one cloth piece. The first
          cloth piece name auto-fills with the garment name.
        </p>
      </div>

      <div className="space-y-3">
        <GarmentOrderCard
          key={active.id}
          jobId={job.id}
          garmentOrder={active}
          garmentIndex={activeGarmentIdx + 1}
          garmentTotal={job.garment_orders.length}
          onReload={onReload}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 border-t border-hairline bg-chalk-white/95 px-4 py-3 pb-safe backdrop-blur">
        {hasCloth ? (
          <div className="mx-auto flex max-w-column items-center justify-between gap-3">
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
              Continue → measurements
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-column space-y-2">
            <p className="text-center text-caption text-muted">
              Add at least one cloth piece for this garment to continue.
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
  // Cloth dimensions are captured in inches only. Materials saved before this
  // (unit m/cm) are converted on open so the numbers stay correct.
  const legacyToInches =
    initial?.unit === "m" ? 39.3701 : initial?.unit === "cm" ? 0.393701 : 1;
  const asInches = (v: number | null | undefined): string =>
    v == null ? "" : String(Math.round(v * legacyToInches * 10) / 10);
  const [length, setLength] = useState(asInches(initial?.length));
  const [breadth, setBreadth] = useState(asInches(initial?.breadth));
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
        unit: "in",
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

      {/* Cloth dimensions — inches only */}
      {type === "cloth" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-navy">
              Length (in)
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
              Breadth (in)
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
