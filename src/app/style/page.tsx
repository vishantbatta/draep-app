"use client";

/**
 * Style selection — the first screen after tapping the landing CTA.
 *
 * Split layout:
 *   Top 30%    → "Share your design preference" heading
 *                Primary CTA: "Upload your design" (orange button)
 *                Secondary CTA: "Build from scratch" (text-only link)
 *   --- dotted "or" divider ---
 *   Bottom 70% → scrollable grid of regional blouse templates
 *
 * Scroll-collapse: top section shrinks to a slim bar when the grid scrolls.
 *
 * Navigation:
 *   - Build from scratch → /design/cut (custom design flow)
 *   - Upload             → file picker → /review
 *   - Template tap       → /review
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Upload, ArrowLeft } from "@/components/ui/icons";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { DESIGN_ROUTES, REVIEW_ROUTE } from "@/lib/routing";

/* ---- Template data — regional blouse styles ---- */

interface Template {
  id: string;
  name: string;
  bg: string;
  accent: string;
}

const TEMPLATES: Template[] = [
  { id: "t1", name: "Jaipuri blouse", bg: "#fff6ea", accent: "#f89010" },
  { id: "t2", name: "Tamil blouse", bg: "#eaf0f8", accent: "#083068" },
  { id: "t3", name: "Indian blouse", bg: "#fde3bf", accent: "#d06010" },
  { id: "t4", name: "Kanjivaram blouse", bg: "#eaf0f8", accent: "#3a5c8f" },
  { id: "t5", name: "Banarasi blouse", bg: "#fff6ea", accent: "#f89010" },
  { id: "t6", name: "Chettinad blouse", bg: "#fde3bf", accent: "#d06010" },
  { id: "t7", name: "Rajasthani blouse", bg: "#eaf0f8", accent: "#083068" },
  { id: "t8", name: "Bengali blouse", bg: "#fff6ea", accent: "#f89010" },
  { id: "t9", name: "Mysore silk blouse", bg: "#eaf0f8", accent: "#3a5c8f" },
  { id: "t10", name: "Pattu saree blouse", bg: "#fde3bf", accent: "#d06010" },
  { id: "t11", name: "Lehenga blouse", bg: "#fff6ea", accent: "#f89010" },
  { id: "t12", name: "Designer blouse", bg: "#eaf0f8", accent: "#083068" },
];

/* ============================================================ */

export default function StylePage() {
  const router = useRouter();
  const initDraft = useBookingStore((s) => s.initDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // IntersectionObserver: collapse header when sentinel scrolls out of view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { root, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  /** Build from scratch → go to the full custom design flow. */
  const handleBuildFromScratch = useCallback(() => {
    clearDraft();
    initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    router.push(DESIGN_ROUTES[0]);
  }, [clearDraft, initDraft, router]);

  /** Upload → open file picker; after selecting, go to review. */
  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearDraft();
    initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    router.replace(REVIEW_ROUTE);
  };

  /** Template tap → go straight to review. */
  const handleTemplateSelect = () => {
    clearDraft();
    initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    router.replace(REVIEW_ROUTE);
  };

  const handleBack = () => router.push("/");

  return (
    <div className="column flex h-dvh flex-col bg-chalk-white">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* ───── Top section (30% → collapses to just the back button) ───── */}
      <header
        className="relative flex flex-none flex-col justify-end overflow-hidden bg-tape text-chalk-white transition-[height] duration-300 ease-brand"
        style={{ height: collapsed ? 36 : "30dvh" }}
      >
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          className="absolute left-3 top-2 z-10 flex items-center gap-1 rounded-pill bg-chalk-white/20 px-2.5 py-1.5 text-caption font-medium text-chalk-white backdrop-blur-sm transition-colors hover:bg-chalk-white/30"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        {/* Expanded layout — heading + CTAs (hidden when collapsed) */}
        {!collapsed && (
          <div className="flex flex-col items-center gap-3 px-4 pb-4">
            <div className="text-center">
              <h1 className="font-heading text-h2 font-semibold">
                {strings.style.topHeading}
              </h1>
              <p className="mt-1 text-caption text-chalk-white/80">
                {strings.style.subheading}
              </p>
            </div>
            {/* Primary CTA — orange button, icon centered */}
            <button
              type="button"
              onClick={handleUpload}
              className="flex w-full max-w-[280px] items-center justify-center gap-2 rounded-pill bg-draep-orange px-5 py-3 font-heading text-body font-semibold text-chalk-white shadow-brand transition-all hover:brightness-105 active:scale-[0.98]"
            >
              <Upload size={18} />
              {strings.style.uploadCta}
            </button>
            {/* Secondary CTA — text only */}
            <button
              type="button"
              onClick={handleBuildFromScratch}
              className="text-caption font-medium text-chalk-white/80 underline-offset-2 transition-colors hover:text-chalk-white hover:underline"
            >
              {strings.style.buildCta}
            </button>
          </div>
        )}
      </header>

      {/* ───── Dotted "or" divider (hidden when collapsed) ───── */}
      {!collapsed && (
        <div className="relative flex flex-none items-center justify-center py-2">
          <div className="h-px flex-1 border-t border-dashed border-tape-silver" />
          <span className="mx-3 text-caption font-medium text-ink-navy/50">
            {strings.style.or}
          </span>
          <div className="h-px flex-1 border-t border-dashed border-tape-silver" />
        </div>
      )}

      {/* ───── Bottom section (70% — scrollable template grid) ───── */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* Sentinel */}
        <div ref={sentinelRef} className="h-px w-full" aria-hidden />

        <div className="px-4 pt-1">
          <h2 className="font-heading text-h3 font-semibold text-ink-navy">
            {strings.style.libraryHeading}
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 p-4">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} template={t} onSelect={handleTemplateSelect} />
          ))}
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}

/* ============================================================ */

function TemplateCard({
  template,
  onSelect,
}: {
  template: Template;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group overflow-hidden rounded-card border border-tape-silver/50 bg-chalk-white text-left transition-all hover:border-navy-interactive hover:shadow-brand active:scale-[0.98]"
    >
      <div
        className="flex aspect-[3/4] items-center justify-center"
        style={{ backgroundColor: template.bg }}
      >
        <BlouseGlyph color={template.accent} />
      </div>
      <div className="px-3 py-2">
        <p className="truncate text-body font-medium text-ink-navy">
          {template.name}
        </p>
      </div>
    </button>
  );
}

function BlouseGlyph({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 100 120"
      className="h-20 w-auto opacity-80"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M25 25 L25 100 Q25 105, 30 105 L70 105 Q75 105, 75 100 L75 25" />
      <path d="M40 25 Q50 40, 60 25" />
      <path d="M25 28 L15 40 M75 28 L85 40" />
      <path d="M42 45 L42 85 M58 45 L58 85" opacity={0.4} />
    </svg>
  );
}
