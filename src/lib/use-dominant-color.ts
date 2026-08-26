"use client";

import { useEffect, useState } from "react";

/**
 * Dominant (average) color of an image, sampled down to a tiny canvas for
 * cheap averaging. The white backdrop these reference/catalog shots sit on
 * is skipped so the average picks up the garment itself. Same-origin assets
 * only — a tainted canvas just keeps whatever previous value there was.
 * Returns `rgba(r, g, b, 0.4)` or null while nothing is loaded/sampled.
 */
export function useDominantColor(src: string | undefined): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    setColor(null);
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const s = 12;
        const canvas = document.createElement("canvas");
        canvas.width = s;
        canvas.height = s;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, s, s);
        const d = ctx.getImageData(0, 0, s, s).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) continue;
          // Skip near-white backdrop pixels.
          if (
            Math.min(d[i], d[i + 1], d[i + 2]) > 235 &&
            Math.max(d[i], d[i + 1], d[i + 2]) > 245
          )
            continue;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          n++;
        }
        if (n)
          setColor(
            `rgba(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}, 0.4)`,
          );
      } catch {
        // cross-origin without CORS headers — keep the fallback
      }
    };
    img.src = src;
  }, [src]);

  return color;
}
