"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SOP_VIDEO_LANGUAGES,
  createSopVideoJob,
  getSopVideoJob,
  sopVideoFileUrl,
  type SopVideoJob,
  type SopVideoLang,
} from "@/lib/admin-api";

// ─── Sub-tabs for Configure (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
  { key: "serviceability", label: "Serviceability Areas", href: "/admin/actions/serviceability" },
  { key: "urls", label: "URLs", href: "/admin/actions/urls" },
  { key: "measurements", label: "Measurements", href: "/admin/measurements" },
  { key: "validation-rules", label: "Validation Rules", href: "/admin/catalogue/validation-rules" },
  { key: "sop-video", label: "SOP Video Generator", href: "/admin/actions/sop-video" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

export default function SopVideoActionPage() {
  return (
    <Suspense fallback={null}>
      <SopVideoActionPageInner />
    </Suspense>
  );
}

type Phase = "form" | "working" | "results";

const LANG_LABEL: Record<SopVideoLang, string> = {
  english: "English",
  hindi: "Hindi",
  kannada: "Kannada",
};

const LANG_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  narrating: "Recording narration",
  subtitles: "Timing subtitles",
  building: "Rendering video",
  done: "Done",
  error: "Failed",
};

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SopVideoActionPageInner() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("sop-video");

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: activeActionTab === t.key,
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [activeActionTab, router]);

  // ─── Form state ───────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"generate" | "detect">("generate");
  const [languages, setLanguages] = useState<SopVideoLang[]>(["english"]);
  const [subtitles, setSubtitles] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [phase, setPhase] = useState<Phase>("form");
  const [job, setJob] = useState<SopVideoJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ext = file ? file.name.toLowerCase().endsWith(".pptx") ? ".pptx" : file.name.toLowerCase().endsWith(".pdf") ? ".pdf" : "" : "";
  const isPptx = ext === ".pptx";
  const effectiveMode = isPptx ? mode : "generate";

  // ─── Poll while the job runs ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "working" || !job) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const j = await getSopVideoJob(job.job_id);
        if (cancelled) return;
        setJob(j);
        if (j.status === "completed" || j.status === "failed") setPhase("results");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Lost contact with the generator job.");
        setPhase("results");
      }
    };

    void tick();
    const interval = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, job?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleLang(lang: SopVideoLang) {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  async function handleGenerate() {
    if (!file || languages.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const { job_id } = await createSopVideoJob({
        file,
        mode: effectiveMode as "generate" | "detect",
        languages,
        subtitles,
      });
      setJob({ job_id, status: "pending", step: "starting", total_slides: 0, subtitles, languages: {}, error: null });
      setPhase("working");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the job.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setPhase("form");
    setJob(null);
    setError(null);
    setFile(null);
    setLanguages(["english"]);
    setMode("generate");
    setSubtitles(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const canGenerate = !!file && languages.length > 0 && phase === "form";

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">
          SOP Video Generator
        </h1>
        {phase === "results" && (
          <button
            type="button"
            onClick={handleReset}
            className="tap rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
          >
            Generate another
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {phase === "form" && (
        <div className="max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
          {/* 1. File */}
          <div className="mb-6">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Upload Deck
            </label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`tap flex w-full items-center justify-between gap-3 rounded-pill border px-4 py-3 text-left transition ${
                file
                  ? "border-ink-navy bg-mist-navy/40"
                  : "border-dashed border-hairline-strong bg-chalk-white hover:bg-mist-navy/30"
              }`}
            >
              <span className="min-w-0 truncate text-data text-ink">
                {file ? file.name : "Choose a .pptx or .pdf file…"}
              </span>
              <span className="shrink-0 rounded-pill bg-ink-navy/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-navy">
                {isPptx ? "PPTX" : ext === ".pdf" ? "PDF" : "Browse"}
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !f.name.toLowerCase().endsWith(".pptx")) setMode("generate");
              }}
            />
            <p className="mt-1 text-[11px] text-muted">
              Video aspect ratio follows the deck. Rendered at 1080p MP4.
            </p>
          </div>

          {/* 2. Speaker notes mode */}
          <div className="mb-6">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Speaker Notes
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("generate")}
                disabled={!isPptx}
                className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  effectiveMode === "generate"
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                }`}
              >
                Generate with AI
              </button>
              <button
                type="button"
                onClick={() => setMode("detect")}
                disabled={!isPptx}
                title={isPptx ? "Read notes embedded in the PPTX" : "Only PPTX files carry notes"}
                className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  effectiveMode === "detect"
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
                }`}
              >
                Detect from PPTX
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {isPptx
                ? "Detect reads [ENGLISH]/[HINDI]/[KANNADA] sections from the PPTX notes; missing languages are AI-generated."
                : "PDFs have no embedded notes — narration is always AI-generated."}
            </p>
          </div>

          {/* 3. Languages */}
          <div className="mb-6">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Languages
            </label>
            <div className="flex flex-wrap gap-4">
              {SOP_VIDEO_LANGUAGES.map(({ key, label }) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-data text-ink">
                  <input
                    type="checkbox"
                    checked={languages.includes(key)}
                    onChange={() => toggleLang(key)}
                    className="h-4 w-4 cursor-pointer rounded border-hairline-strong accent-ink-navy"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 4. Subtitles */}
          <div className="mb-6">
            <label className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
              Subtitles
            </label>
            <button
              type="button"
              onClick={() => setSubtitles((s) => !s)}
              className={`tap flex items-center gap-3 rounded-pill border px-4 py-2 text-caption font-medium transition ${
                subtitles
                  ? "border-ink-navy bg-ink-navy text-chalk-white"
                  : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
              }`}
            >
              <span
                className={`inline-block h-4 w-7 rounded-full transition ${subtitles ? "bg-chalk-white/30" : "bg-hairline-strong"}`}
              >
                <span
                  className={`mt-0.5 block h-3 w-3 rounded-full bg-chalk-white transition ${subtitles ? "translate-x-3.5" : "translate-x-0.5"}`}
                />
              </span>
              {subtitles ? "Burned-in subtitles" : "No subtitles"}
            </button>
            <p className="mt-1 text-[11px] text-muted">
              Timings come from Gemini audio timestamps for the spoken narration.
            </p>
          </div>

          {/* 5. Generate */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || submitting}
              className="tap flex items-center gap-2 rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Spinner />}
              {submitting ? "Starting…" : "Generate"}
            </button>
            {!file && <span className="text-[12px] text-muted">Upload a deck to begin.</span>}
            {file && languages.length === 0 && (
              <span className="text-[12px] text-error-text">Pick at least one language.</span>
            )}
          </div>
        </div>
      )}

      {/* 6. Loading state */}
      {phase === "working" && job && (
        <div className="max-w-2xl rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="text-ink-navy">
              <Spinner className="h-5 w-5" />
            </span>
            <div>
              <p className="text-data font-medium text-ink-navy">Generating your SOP videos…</p>
              <p className="text-[11px] capitalize text-muted">{job.step}</p>
            </div>
          </div>
          <div className="space-y-2">
            {Object.entries(job.languages).map(([lang, st]) => (
              <div
                key={lang}
                className="flex items-center justify-between rounded-pill border border-hairline bg-chalk-white px-4 py-2.5"
              >
                <span className="text-data font-medium text-ink-navy">
                  {LANG_LABEL[lang as SopVideoLang] ?? lang}
                </span>
                <span className="flex items-center gap-2 text-caption text-muted">
                  {st?.status === "narrating" && (
                    <span>
                      {st.slides_done} / {job.total_slides || "…"} slides
                    </span>
                  )}
                  {st && LANG_STATUS_LABEL[st.status]}
                  {st && !["done", "error"].includes(st.status) && (
                    <span className="text-ink-navy">
                      <Spinner className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-muted">
            Keep this tab open — finished videos are served from memory and expire after 2 hours.
          </p>
        </div>
      )}

      {/* 7. Results */}
      {phase === "results" && job && (
        <div>
          {job.status === "failed" && (
            <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
              {job.error ?? "Generation failed."}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {Object.entries(job.languages).map(([lang, st]) => {
              if (!st) return null;
              const failed = st.status === "error";
              return (
                <div
                  key={lang}
                  className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-eyebrow text-ink-navy">
                      {LANG_LABEL[lang as SopVideoLang] ?? lang}
                    </span>
                    {st.duration_s != null && (
                      <span className="text-[11px] text-muted">
                        {Math.round(st.duration_s)}s · {job.total_slides} slides
                      </span>
                    )}
                  </div>
                  {failed ? (
                    <div className="rounded-card border border-error-border bg-error-bg px-3 py-6 text-center text-caption text-error-text">
                      {st.error ?? "This language failed."}
                    </div>
                  ) : (
                    <>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        controls
                        preload="metadata"
                        src={sopVideoFileUrl(job.job_id, lang as SopVideoLang)}
                        className="mb-3 w-full rounded-card border border-hairline bg-ink-navy"
                      />
                      <a
                        href={sopVideoFileUrl(job.job_id, lang as SopVideoLang)}
                        download={st.filename ?? `Draep_SOP_${lang}.mp4`}
                        className="tap flex items-center justify-center rounded-pill bg-ink-navy px-4 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
                      >
                        Download MP4
                      </a>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
