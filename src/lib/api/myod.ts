/**
 * MYOD API client — vector SVG edit + final AI render.
 *
 * POST /myod/svg-edit — sends current front/back SVGs + full config + history,
 * returns updated front/back SVGs.
 *
 * POST /myod/render — sends the FINAL front/back SVGs + config summary,
 * returns realistic product photos (front/back/side) of the finished blouse.
 */

import { apiPost } from "./client";

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
