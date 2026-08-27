/**
 * MYOD API client — vector SVG edit + final AI render.
 *
 * POST /myod/svg-edit — sends current front/back SVGs + full config + history,
 * returns updated front/back SVGs.
 *
 * POST /myod/render-stream — sends the final config summary (the render is
 * specified by config text alone, no line drawings); the backend draws ONE
 * image — a 21:9 sheet with the front, back and side views side by side —
 * in a single call and streams it as an SSE event (renderBlouseSheet fires
 * onSheet when the sheet lands).
 * POST /myod/render is the non-streaming equivalent.
 *
 * POST /myod/order — turns a finished run into a pending order (selections
 * as items, renders as inspiration images) for booking on /app/orders/{id}.
 * The garment note starts empty — the customer adds one on the order page.
 */

import { ApiError, apiPost, apiPostStream } from "./client";
import type { Selections } from "@/lib/myod-steps";

export interface MyodSvgEditResult {
  front_svg: string;
  back_svg: string;
}

export interface MyodSvgEditParams {
  currentFrontSvg: string;
  currentBackSvg: string;
  currentConfig: string;
  newConfig: string;
  changeLabel: string;
  changeDescription: string;
  editHistory: string;
}

export async function editBlouseSvg(
  params: MyodSvgEditParams,
): Promise<MyodSvgEditResult> {
  return apiPost<MyodSvgEditResult>("/myod/svg-edit", {
    current_front_svg: params.currentFrontSvg,
    current_back_svg: params.currentBackSvg,
    current_config: params.currentConfig,
    new_config: params.newConfig,
    change_label: params.changeLabel,
    change_description: params.changeDescription,
    edit_history: params.editHistory,
  });
}

/** One streamed render — the single 3-view product sheet. */
export interface MyodRenderView {
  view: string;
  url: string;
}

export interface MyodRenderResult {
  views: MyodRenderView[];
}

export interface MyodRenderParams {
  configText: string;
  /** Optional customer feedback for a refinement pass. */
  comment?: string;
  /** Previous render URLs (/designs/ai/…) fed back as image references. */
  referenceImages?: string[];
}

/**
 * Render the finished garment as ONE image — a 21:9 sheet with the front,
 * back and side views side by side, drawn in a single Gemini call.
 *
 * The backend streams the sheet as an SSE `view` event the moment it lands
 * (onSheet fires then), so the UI can paint it straight away.
 */
export async function renderBlouseSheet(
  params: MyodRenderParams,
  onSheet?: (view: MyodRenderView) => void,
): Promise<MyodRenderResult> {
  const res = await apiPostStream("/myod/render-stream", {
    config_text: params.configText,
    ...(params.comment ? { comment: params.comment } : {}),
    ...(params.referenceImages?.length ? { reference_images: params.referenceImages } : {}),
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const views: MyodRenderView[] = [];
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line; parse every complete one.
      for (let sep = buffer.indexOf("\n\n"); sep >= 0; sep = buffer.indexOf("\n\n")) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseFrame(frame);
        if (!event) continue;
        if (event.name === "view") {
          const view = JSON.parse(event.data) as MyodRenderView;
          if (view.view && view.url) {
            views.push(view);
            onSheet?.(view);
          }
        } else if (event.name === "error") {
          const err = JSON.parse(event.data) as {
            code?: string;
            message?: string;
            status?: number;
            details?: Record<string, unknown>;
          };
          throw new ApiError(
            err.code ?? "myod_render_failed",
            err.message ?? "We couldn't render the final image. Please try again.",
            err.status ?? 502,
            err.details ?? {},
          );
        }
        // `done` needs no handling — the views above are the result.
      }
    }
  } catch (err) {
    // The stream died before the sheet landed (e.g. the dev proxy's ~60s
    // ceiling). Nothing to show — surface the failure.
    if (!views.length || (err instanceof DOMException && err.name === "AbortError"))
      throw err;
  }
  return { views };
}

/** One SSE frame: `event: <name>` + `data: <json>` (data may span lines). */
function parseSseFrame(frame: string): { name: string; data: string } | null {
  let name = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  return { name, data: dataLines.join("\n") };
}

export interface MyodOrderResult {
  id: string;
  order_number?: string | null;
}

export interface MyodOrderParams {
  garmentId: string;
  /** Wizard selection state, keyed by component-or-addon id. */
  selections: Selections;
  /** Render photo URLs to attach as the design's inspiration images. */
  assets: string[];
}

export async function createMyodOrder(
  params: MyodOrderParams,
): Promise<MyodOrderResult> {
  const selections: Record<
    string,
    {
      variation_id: string;
      variation_type_id?: string;
      placement?: string;
      picks?: { variation_id: string; variation_type_id?: string; placement?: string }[];
    }
  > = {};
  for (const [key, sel] of Object.entries(params.selections)) {
    selections[key] = {
      variation_id: sel.variationId,
      ...(sel.variationTypeId ? { variation_type_id: sel.variationTypeId } : {}),
      ...(sel.placement ? { placement: sel.placement } : {}),
      ...(sel.picks?.length
        ? {
            picks: sel.picks.map((p) => ({
              variation_id: p.variationId,
              ...(p.variationTypeId ? { variation_type_id: p.variationTypeId } : {}),
              ...(p.placement ? { placement: p.placement } : {}),
            })),
          }
        : {}),
    };
  }
  return apiPost<MyodOrderResult>("/myod/order", {
    garment_id: params.garmentId,
    selections,
    assets: params.assets,
  });
}
