/**
 * Routing helpers — single source of truth for the design step order
 * and deep-link helpers (?from=review).
 */

import { CATALOG } from "@/lib/catalog";

export const DESIGN_ROUTES = [
  "/design/cut",
  "/design/length",
  "/design/front-neck",
  "/design/back",
  "/design/tying",
  "/design/fit",
  "/design/add-ons",
] as const;

export const REVIEW_ROUTE = "/review";
export const CONTACT_ROUTE = "/contact";
export const PAY_ROUTE = "/pay";
export const CONFIRMED_ROUTE = "/confirmed";

/** Protected routes — direct URL entry with empty/expired draft redirects to /. */
export const PROTECTED_ROUTES = [
  ...DESIGN_ROUTES,
  REVIEW_ROUTE,
  CONTACT_ROUTE,
  PAY_ROUTE,
  CONFIRMED_ROUTE,
];

export function stepNumber(route: string): number {
  const idx = DESIGN_ROUTES.indexOf(route as (typeof DESIGN_ROUTES)[number]);
  return idx === -1 ? 0 : idx + 1;
}

export function nextRouteAfter(route: string): string | null {
  if (route === REVIEW_ROUTE) return CONTACT_ROUTE;
  const idx = DESIGN_ROUTES.indexOf(route as (typeof DESIGN_ROUTES)[number]);
  if (idx === -1) return null;
  if (idx === DESIGN_ROUTES.length - 1) return REVIEW_ROUTE;
  return DESIGN_ROUTES[idx + 1];
}

export function prevRouteBefore(route: string): string | null {
  const idx = DESIGN_ROUTES.indexOf(route as (typeof DESIGN_ROUTES)[number]);
  if (idx <= 0) return "/";
  return DESIGN_ROUTES[idx - 1];
}

export function isDesignRoute(route: string): boolean {
  return DESIGN_ROUTES.includes(route as (typeof DESIGN_ROUTES)[number]);
}

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );
}

/** All routes that should show the TapeProgress header. */
export const TAPE_HEADER_ROUTES = [...DESIGN_ROUTES, REVIEW_ROUTE];

/** The tape shows 7 ticks — 5 critical + fit + add-ons (spec §5.1, §4). */
export const TOTAL_DESIGN_STEPS = DESIGN_ROUTES.length;

export function routeToCategoryId(route: string): string | null {
  const cat = CATALOG.find((c) => c.route === route);
  return cat?.id ?? null;
}
