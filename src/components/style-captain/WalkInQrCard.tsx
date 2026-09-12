"use client";

import { useEffect, useState } from "react";

import { buildShortLinkQrSvg, loadLogoDataUrl } from "@/lib/qr-code";

/**
 * House-styled QR (same renderer as the shortlink QRs — diamonds, gradient
 * eyes, Draep logo) shown inline for the customer to scan off the captain's
 * screen. Renders via a data URL so there is no blob lifetime to manage.
 */
export function WalkInQrCard({
  url,
  caption,
}: {
  url: string;
  caption?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    (async () => {
      try {
        const logo = await loadLogoDataUrl();
        const svg = buildShortLinkQrSvg(url, logo);
        if (!cancelled) {
          setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to generate QR",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-hairline bg-chalk-white p-5">
      {error ? (
        <div className="px-4 py-6 text-center text-caption text-error-text">
          {error}
        </div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="QR code to open the order payment page"
          className="h-56 w-56"
        />
      ) : (
        <div className="flex h-56 w-56 items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-navy border-t-transparent" />
        </div>
      )}
      {caption && (
        <div className="text-center text-caption text-muted">{caption}</div>
      )}
    </div>
  );
}
