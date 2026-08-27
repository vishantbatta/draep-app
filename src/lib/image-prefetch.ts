/**
 * Background image prefetch for the MYOD wizard.
 *
 * Layer 1 of the image-loading plan: the moment the design tree is ready,
 * every step's images are fetched in the background — idle-started so the
 * first page's own images always win, and pulled 3 at a time so the queue
 * never competes with real navigation. Later steps then render fully
 * populated from the browser cache instead of popping in thumbnail by
 * thumbnail.
 *
 * Plain same-origin assets under /designs/… — browser HTTP cache does the
 * rest, and per-image caching survives catalog edits. If the catalog ever
 * moves behind a signed/pay-per-fetch CDN, revisit this (prefetching would
 * spend money on images never seen).
 */

import type { DesignStep } from "./myod-steps";

/** Every image URL referenced anywhere in the wizard's steps, deduped. */
export function collectStepImageUrls(steps: DesignStep[]): string[] {
  const urls = new Set<string>();
  for (const step of steps) {
    for (const c of step.components) {
      if (c.assetUrl) urls.add(c.assetUrl);
      for (const o of c.options) {
        if (o.assetUrl) urls.add(o.assetUrl);
        for (const s of o.subOptions ?? []) {
          if (s.assetUrl) urls.add(s.assetUrl);
        }
      }
    }
  }
  return [...urls];
}

/**
 * Run cb when the main thread is idle — the prefetch must never race the
 * first page's own images for bandwidth or CPU. Falls back to a short
 * timer where requestIdleCallback doesn't exist (Safari).
 */
export function scheduleIdle(cb: () => void): void {
  if (typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(cb, { timeout: 3000 });
  } else {
    window.setTimeout(cb, 800);
  }
}

const PREFETCH_CONCURRENCY = 3;

/**
 * Warm the browser cache with the given URLs, PREFETCH_CONCURRENCY at a
 * time. Fire-and-forget: failures are ignored (the real <img> tags retry
 * by simply being rendered later), and the browser dedupes any URL that is
 * already in flight or cached.
 */
export function prefetchImages(urls: string[]): void {
  if (typeof window === "undefined") return;
  let next_index = 0;
  const loadNext = () => {
    if (next_index >= urls.length) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = img.onerror = loadNext;
    img.src = urls[next_index++];
  };
  for (let k = 0; k < Math.min(PREFETCH_CONCURRENCY, urls.length); k++) {
    loadNext();
  }
}
