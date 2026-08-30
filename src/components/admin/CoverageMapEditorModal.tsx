"use client";

/**
 * CoverageMapEditorModal — SSR-safe wrapper.
 *
 * Leaflet touches `window` at import time, so the editor must never be
 * evaluated on the server: pages that prerender (e.g. the static
 * /admin/actions routes) crash `next build` with "window is not defined"
 * if they import CoverageMapEditor directly. This wrapper loads it with
 * next/dynamic + ssr:false — same pattern as contact/MapPinPicker.
 * Props are identical to CoverageMapEditorProps.
 */

import dynamic from "next/dynamic";
import type { CoverageMapEditorProps } from "./CoverageMapEditor";

const CoverageMapEditor = dynamic(
  () =>
    import("./CoverageMapEditor").then((m) => ({
      default: m.CoverageMapEditor,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-ink-navy/50 p-4">
        <div className="flex h-[70vh] w-full max-w-4xl items-center justify-center rounded-xl bg-chalk-white">
          <span
            aria-hidden
            className="h-6 w-6 animate-spin rounded-full border-[3px] border-mist-navy border-t-draep-orange"
          />
        </div>
      </div>
    ),
  },
);

export function CoverageMapEditorModal(props: CoverageMapEditorProps) {
  return <CoverageMapEditor {...props} />;
}
