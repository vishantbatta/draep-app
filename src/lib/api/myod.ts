/**
 * MYOD (Make Your Own Draep) API client — step-by-step blouse design.
 *
 * POST /myod/create  — initial generation from the first step's design brief.
 * POST /myod/refine  — image-to-image edit using the cumulative design brief
 *   plus the single change made in the latest step.
 *
 * Both return { output_url, suggestions }.
 */

import { apiPost } from "./client";

export interface MyodResult {
  output_url: string;
  suggestions: string[];
}

export interface MyodSvgResult {
  svg: string;
}

/**
 * EXPERIMENT: generate a vector SVG of the blouse from the design brief via
 * gemini-3.6-flash (fast text model). Returns raw SVG markup for inline render.
 */
export async function blouseSvg(
  designBrief: string,
  garmentId?: string,
): Promise<MyodSvgResult> {
  return apiPost<MyodSvgResult>("/myod/svg", {
    design_brief: designBrief,
    ...(garmentId ? { garment_id: garmentId } : {}),
  });
}

export interface MyodSvgCodeResult {
  code: string;
}

/**
 * EXPERIMENT (sandboxed): ask the model for a Python function that renders the
 * blouse as SVG for ANY state. The FE runs it in a Pyodide WASM sandbox and
 * calls it locally per step (milliseconds). The function is generated once.
 */
export async function blouseSvgCode(
  designBrief: string,
  garmentId?: string,
): Promise<MyodSvgCodeResult> {
  return apiPost<MyodSvgCodeResult>("/myod/svg-code", {
    design_brief: designBrief,
    ...(garmentId ? { garment_id: garmentId } : {}),
  });
}

/**
 * EXPERIMENT: ask the model for a JAVASCRIPT function that renders the blouse
 * as SVG for any state. The FE runs it natively via `new Function` (no Pyodide,
 * no WASM download) — microseconds per render. Dynamic: reads the live catalog
 * state so newly added components are handled automatically.
 */
export async function blouseJsCode(
  designBrief: string,
  garmentId?: string,
): Promise<MyodSvgCodeResult> {
  return apiPost<MyodSvgCodeResult>("/myod/js-code", {
    design_brief: designBrief,
    ...(garmentId ? { garment_id: garmentId } : {}),
  });
}

/**
 * Generate the first garment photo from the initial design brief.
 *
 * @param designBrief  human-readable running brief of choices so far (step 1)
 * @param garmentId    garment ID for fetching style components for suggestions
 */
export async function createBlouse(
  designBrief: string,
  garmentId?: string,
): Promise<MyodResult> {
  return apiPost<MyodResult>("/myod/create", {
    design_brief: designBrief,
    ...(garmentId ? { garment_id: garmentId } : {}),
  });
}

/**
 * Edit the current garment photo to reflect the latest step's change.
 *
 * @param currentImage  data URI of the current garment photo
 * @param designBrief   full running brief of every choice so far
 * @param change        the single change applied in this step
 * @param garmentId     garment ID for fetching style components for suggestions
 */
export async function refineBlouse(
  currentImage: string,
  designBrief: string,
  change: string,
  garmentId?: string,
): Promise<MyodResult> {
  return apiPost<MyodResult>(
    "/myod/refine",
    {
      current_image: currentImage,
      design_brief: designBrief,
      change,
      ...(garmentId ? { garment_id: garmentId } : {}),
    },
  );
}
