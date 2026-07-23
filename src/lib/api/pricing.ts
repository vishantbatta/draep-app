/**
 * Pricing API — stateless price computation.
 * Mirrors be/app/api/pricing.py
 */

import { apiPost } from "./client";
import type {
  PricingComputeIn,
  PriceBreakdownOut,
} from "@/types/api";

export function computePrice(
  body: PricingComputeIn,
  signal?: AbortSignal,
): Promise<PriceBreakdownOut> {
  return apiPost<PriceBreakdownOut>("/pricing/compute", body, { signal });
}
