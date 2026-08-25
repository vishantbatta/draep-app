/**
 * MYOD API client — vector SVG edit + final AI render.
 *
 * POST /myod/svg-edit — sends current front/back SVGs + full config + history,
 * returns updated front/back SVGs.
 *
 * POST /myod/render — sends the FINAL front/back SVGs + config summary,
 * returns realistic product photos (front/back/side) of the finished blouse.
 *
 * POST /myod/order — turns a finished run into a pending order (selections
 * as items, renders as inspiration images) for booking on /app/orders/{id}.
 */

import { apiPost } from "./client";
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

export interface MyodRenderView {
  view: string;
  url: string;
}

export interface MyodRenderResult {
  views: MyodRenderView[];
}

export interface MyodRenderParams {
  frontSvg: string;
  backSvg: string;
  configText: string;
  /** Optional customer feedback for a refinement pass. */
  comment?: string;
  /** Previous render URLs (/designs/ai/…) fed back as image references. */
  referenceImages?: string[];
  /** Targeted gap-fill retry: view names to skip (already have good renders). */
  skipViews?: string[];
}

export async function renderBlouseViews(
  params: MyodRenderParams,
): Promise<MyodRenderResult> {
  return apiPost<MyodRenderResult>("/myod/render", {
    front_svg: params.frontSvg,
    back_svg: params.backSvg,
    config_text: params.configText,
    ...(params.comment ? { comment: params.comment } : {}),
    ...(params.referenceImages?.length ? { reference_images: params.referenceImages } : {}),
    ...(params.skipViews?.length ? { skip_views: params.skipViews } : {}),
  });
}

export interface MyodOrderResult {
  id: string;
  order_number?: string | null;
}

export interface MyodOrderParams {
  garmentId: string;
  /** Wizard selection state, keyed by component-or-addon id. */
  selections: Selections;
  configText: string;
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
    config_text: params.configText,
    assets: params.assets,
  });
}
