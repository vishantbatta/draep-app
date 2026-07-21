/**
 * Route protection — single source of truth (per plan, validated by Plan agent).
 *
 * Reads the lightweight `draep_draft` cookie that Zustand syncs on every
 * persist write. Cookie carries only "exists + not expired" — never the draft.
 * Cleaner than per-layout guards and avoids the one-frame flash a client-side
 * hook would produce on protected routes.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isProtectedRoute } from "@/lib/routing";

const DRAFT_COOKIE_NAME = "draep_draft";
const PUBLIC_PATHS = new Set(["/", "/design/cut"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Landing and the very first design step are always public — the latter
  // is where we initialize the draft, so blocking it would deadlock.
  if (PUBLIC_PATHS.has(pathname) || !isProtectedRoute(pathname)) {
    return NextResponse.next();
  }

  const hasDraft = req.cookies.get(DRAFT_COOKIE_NAME)?.value === "1";
  if (!hasDraft) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on app routes only; skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
