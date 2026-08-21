"use client";

/**
 * next-pwa 5.6.0 injects its service-worker register script only into the
 * pages-router `main.js` webpack entry, so app-router builds never register
 * /sw.js at all — the worker sits unused and Chrome never fires the install
 * prompt. Register it from the client bundle instead.
 *
 * The import must be production-gated: next-pwa's build-time defines (and sw.js
 * generation) don't exist in dev, so importing the module there throws on the
 * undefined `__PWA_SW__` constants.
 */

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      import("next-pwa/register");
    }
  }, []);

  return null;
}
