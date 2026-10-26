/**
 * Auto-design API client — "Share a design with us".
 *
 * POST /auto-design/upload          — host 1–6 customer photos; returns their
 *                                     /designs/ai/ref_… URLs (later the order's
 *                                     inspiration images).
 * POST /auto-design/analyze-stream  — SSE. One `stage` event per pipeline
 *                                     step (checklist rows), then exactly one
 *                                     terminal event: `done`,
 *                                     `garment_unresolved` or `error`.
 *
 * SSE is parsed here (EventSource can't POST), same framing as
 * /myod/render-stream.
 */

import { ApiError, apiPostStream, apiUpload } from "./client";

// ─── Wire types (mirror app/services/auto_design.py) ─────────────────────────

export interface AutoDesignSelection {
  component_id: string;
  component_label: string | null;
  variation_id: string;
  variation_label: string | null;
  variation_type_id: string | null;
  variation_type_label: string | null;
}

export interface AutoDesignAddon {
  addon_id: string;
  addon_label: string | null;
  addon_variation_id: string | null;
  addon_variation_label: string | null;
  /** Placements the photos showed it at, from the add-on's own list. */
  placement: string[] | null;
}

export interface AutoDesignDone {
  garment_id: string;
  selections: AutoDesignSelection[];
  addons: AutoDesignAddon[];
  /** Critical component ids the photos didn't settle — the customer is
   *  asked for exactly these on the MYOD steps. */
  missing_critical: string[];
}

export type AutoDesignStep = "garment" | "component" | "non_critical" | "addons";

export interface AutoDesignStageEvent {
  step: AutoDesignStep;
  status: "start" | "done";
  label: string;
  /** Set for `component` rows — the checklist key. */
  component_id?: string;
  /** `done` only: what was picked, or null when nothing matched. */
  picked?: { id?: string; label: string } | null;
  /** `done` only, group rows: how many items were identified. */
  found?: number;
}

export type AutoDesignOutcome =
  | { kind: "done"; result: AutoDesignDone }
  | { kind: "garment_unresolved" };

// ─── Upload ──────────────────────────────────────────────────────────────────

export async function uploadDesignPhotos(files: File[]): Promise<string[]> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const out = await apiUpload<{ urls: string[] }>("/auto-design/upload", form);
  return out.urls;
}

// ─── SSE reader ──────────────────────────────────────────────────────────────

export interface SseEvent {
  name: string;
  /** Parsed JSON when the data line(s) are JSON; the raw string otherwise. */
  data: unknown;
}

/** One frame: `event: <name>` + one or more `data:` lines (joined with \n).
 *  Comment lines (`:`) are skipped; a frame with no data is nothing. */
function parseSseFrame(frame: string): SseEvent | null {
  let name = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { name, data };
}

/**
 * Walk a streaming response frame by frame. Frames end with a blank line;
 * chunk boundaries may fall anywhere, so bytes are buffered until a frame
 * completes. A trailing frame without its blank line (server closed right
 * after `done`) is flushed at EOF.
 */
export async function readSseEvents(
  res: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (frame: string) => {
    const event = parseSseFrame(frame);
    if (event) onEvent(event);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    for (let sep = buffer.indexOf("\n\n"); sep >= 0; sep = buffer.indexOf("\n\n")) {
      emit(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) emit(buffer);
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

export interface AnalyzeDesignParams {
  imageUrls: string[];
  /** Known garment (manual pick after `garment_unresolved`) — skips detection. */
  garmentId?: string;
  onStage?: (event: AutoDesignStageEvent) => void;
  /** Abort = the customer cancelled; rejects with the AbortError as-is. */
  signal?: AbortSignal;
}

/**
 * Run the staged analysis and resolve with its terminal outcome. `onStage`
 * fires for every checklist row as it lands. An `error` event or a stream
 * that ends without a terminal event rejects with an ApiError — the caller
 * shows Retry and re-runs with the same hosted URLs (no re-upload).
 */
export async function analyzeDesignStream(
  params: AnalyzeDesignParams,
): Promise<AutoDesignOutcome> {
  const res = await apiPostStream(
    "/auto-design/analyze-stream",
    {
      image_urls: params.imageUrls,
      ...(params.garmentId ? { garment_id: params.garmentId } : {}),
    },
    { signal: params.signal },
  );

  let outcome: AutoDesignOutcome | null = null;
  let failure: ApiError | null = null;
  try {
    await readSseEvents(res, (event) => {
      if (failure || outcome) return;
      switch (event.name) {
        case "stage":
          params.onStage?.(event.data as AutoDesignStageEvent);
          break;
        case "done":
          outcome = { kind: "done", result: event.data as AutoDesignDone };
          break;
        case "garment_unresolved":
          outcome = { kind: "garment_unresolved" };
          break;
        case "error": {
          const err = (event.data ?? {}) as {
            code?: string;
            message?: string;
            status?: number;
          };
          failure = new ApiError(
            err.code ?? "auto_design_failed",
            err.message ?? "We couldn't read the design from these photos. Please try again.",
            err.status ?? 502,
            {},
          );
          break;
        }
        default:
          break;
      }
    });
  } catch (err) {
    // A mid-stream transport failure (a proxy cutting a slow request) would
    // otherwise surface as the browser's raw "network error". Abort is the
    // caller's Cancel — rethrown as-is; everything else becomes the same
    // retryable message as a stream that ended without a terminal event.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(
      "auto_design_stream_ended",
      "The connection dropped before we finished reading your photos. Please try again.",
      0,
      {},
    );
  }

  if (failure) throw failure;
  if (!outcome) {
    throw new ApiError(
      "auto_design_stream_ended",
      "The connection dropped before we finished reading your photos. Please try again.",
      0,
      {},
    );
  }
  return outcome;
}
