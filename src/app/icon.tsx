/**
 * App icon — Brand Book §3.5: symbol only, white curl on a Tape Gradient tile.
 *
 * Next.js App Router uses icon.tsx as the favicon / app icon source.
 */

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #F89010 0%, #E87810 33%, #D06010 66%, #A85010 100%)",
          borderRadius: 8,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 48 48"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Alpha-tape loop (same shape as DraepSymbol, white-on-gradient) */}
          <path d="M9 30 C 9 18, 22 10, 30 16 C 38 22, 36 32, 26 33 C 18 34, 13 28, 18 22" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
