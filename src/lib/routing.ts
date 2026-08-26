/**
 * Routing helpers — checkout flow order and protected-route checks.
 *
 * The legacy /design/* configurator steps were removed (superseded by the
 * /myod/[garment_id] flow); only the post-design checkout routes remain.
 */

export const REVIEW_ROUTE = "/review";
export const CONTACT_ROUTE = "/contact";
export const SCHEDULE_ROUTE = "/schedule";
export const PAY_ROUTE = "/pay";
export const CONFIRMED_ROUTE = "/confirmed";

/** Protected routes — direct URL entry with empty/expired draft redirects to /. */
export const PROTECTED_ROUTES = [
  REVIEW_ROUTE,
  CONTACT_ROUTE,
  SCHEDULE_ROUTE,
  PAY_ROUTE,
  CONFIRMED_ROUTE,
];

export function nextRouteAfter(route: string): string | null {
  if (route === REVIEW_ROUTE) return CONTACT_ROUTE;
  return null;
}

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );
}
