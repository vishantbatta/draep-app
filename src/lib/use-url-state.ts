"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

// ═══════════════════════════════════════════════════════════════════════════════
// useUrlState — sync a piece of React state to URL search params
//
// Usage:
//   const [table, setTable] = useUrlState("table", "users");
//
// On first render, reads from ?table=xxx in the URL. If absent, uses the default.
// On setTable("yyy"), updates the URL via router.replace (no history entry).
// ═══════════════════════════════════════════════════════════════════════════════

export function useUrlState(
  key: string,
  defaultValue: string,
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = searchParams.get(key);
  const value = urlValue ?? defaultValue;

  // Guard against hydration mismatch — render the URL value only after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const setValue = useCallback(
    (newValue: string) => {
      const params = new URLSearchParams(window.location.search);
      if (newValue === defaultValue || newValue === "") {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, key, defaultValue],
  );

  // Before mount, return default to avoid hydration mismatch
  const effectiveValue = mounted ? value : defaultValue;

  return [effectiveValue, setValue];
}

// ═══════════════════════════════════════════════════════════════════════════════
// useUrlStatePush — same as useUrlState but uses router.push (adds history entry)
// Use for navigation that should appear in back-button history (e.g. drill-down)
// ═══════════════════════════════════════════════════════════════════════════════

export function useUrlStatePush(
  key: string,
  defaultValue: string,
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = searchParams.get(key);
  const value = urlValue ?? defaultValue;

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const setValue = useCallback(
    (newValue: string) => {
      const params = new URLSearchParams(window.location.search);
      if (newValue === defaultValue || newValue === "") {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, key, defaultValue],
  );

  const effectiveValue = mounted ? value : defaultValue;

  return [effectiveValue, setValue];
}

// ═══════════════════════════════════════════════════════════════════════════════
// useUrlStateMultiple — sync multiple keys at once (atomic URL update)
//
// Usage:
//   const { get, setMany } = useUrlStateMultiple();
//   const table = get("table", "users");
//   const page = get("page", "1");
//   setMany({ table: "orders", page: "2" });
// ═══════════════════════════════════════════════════════════════════════════════

interface UseUrlStateMultipleResult {
  get: (key: string, defaultValue: string) => string;
  setMany: (updates: Record<string, string | null>, mode?: "replace" | "push") => void;
}

export function useUrlStateMultiple(): UseUrlStateMultipleResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const get = useCallback(
    (key: string, defaultValue: string): string => {
      if (!mounted) return defaultValue;
      return searchParams.get(key) ?? defaultValue;
    },
    [searchParams, mounted],
  );

  const setMany = useCallback(
    (updates: Record<string, string | null>, mode: "replace" | "push" = "replace") => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      const target = `${pathname}${qs ? `?${qs}` : ""}`;
      if (mode === "push") {
        router.push(target, { scroll: false });
      } else {
        router.replace(target, { scroll: false });
      }
    },
    [router, pathname],
  );

  return { get, setMany };
}

// ═══════════════════════════════════════════════════════════════════════════════
// useNumUrlState — numeric URL state helper
// ═══════════════════════════════════════════════════════════════════════════════

export function useNumUrlState(
  key: string,
  defaultValue: number,
): [number, (value: number) => void] {
  const [strValue, setStrValue] = useUrlState(key, String(defaultValue));
  const num = parseInt(strValue, 10);
  return [
    isNaN(num) ? defaultValue : num,
    (v: number) => setStrValue(String(v)),
  ];
}
