"use client";

/**
 * Tiny context for ghost-preview signaling: selectors call set(id) on
 * hover/press so a preview layer can show where the choice would land.
 *
 * Defaults to a no-op when rendered outside a preview host.
 */

import { createContext, useContext } from "react";

const PreviewContext = createContext<(id: string | null) => void>(() => {});

export function PreviewContextProvider({
  value,
  children,
}: {
  value: (id: string | null) => void;
  children: React.ReactNode;
}) {
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewSetter() {
  return useContext(PreviewContext);
}
