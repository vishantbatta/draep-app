/**
 * MYOD API client — vector SVG edit.
 *
 * POST /myod/svg-edit — sends current front/back SVGs + full config + history,
 * returns updated front/back SVGs.
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
