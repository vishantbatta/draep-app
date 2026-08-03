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
