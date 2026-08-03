/**
 * LegalLayout — shared chrome for long-form legal pages (T&C, Privacy).
 *
 * These pages are content-dense, so they break the booking-app screen pattern:
 * they sit on Warm Sand with a sticky top bar (back + brand), then a centered
 * column of chalk-white cards. Typography follows Brand Book §5 — Poppins
 * headings, Inter body, IBM Plex Mono for the eyebrow and the "last updated"
 * stamp. Section numbers are mono eyebrows, matching the brand tick motif.
 */

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

interface LegalLayoutProps {
  /** Mono eyebrow above the title, e.g. "Terms & conditions". */
  eyebrow: string;
  title: string;
  /** Optional meta line under the title, e.g. "Last updated …". */
  meta?: ReactNode;
  /** When true, renders the in-page section nav. */
  children: ReactNode;
}

export function LegalLayout({ eyebrow, title, meta, children }: LegalLayoutProps) {
  return (
    <div className="min-h-dvh bg-warm-sand">
      {/* Sticky top bar — back chevron + wordmark, chalk-white with hairline. */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-chalk-white/90 backdrop-blur">
        <div className="column flex h-14 items-center gap-3">
          <Link
            href="/"
            aria-label="Back to home"
            className="tap -ml-2 inline-flex items-center justify-center rounded-pill text-ink-navy"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-ink-navy">
            draep
          </span>
        </div>
      </header>

      {/* Hero — eyebrow, title, last-updated stamp, tape tick strip. */}
      <div className="column pt-6">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 font-heading text-h1 font-semibold text-ink-navy">{title}</h1>
        {meta && (
          <p className="mt-2 font-mono text-caption text-muted">{meta}</p>
        )}
        <div className="lp-tape-strip mt-4 rounded-pill" aria-hidden />
      </div>

      {/* Body — centered column of cards. */}
      <div className="column py-6">
        <div className="space-y-4">{children}</div>

        {/* Cross-link to the sibling legal page + contact. */}
        <LegalFooter />
      </div>
    </div>
  );
}

/**
 * LegalFooter — closes the page with a hairline divider and cross-links to the
 * other legal doc plus Draep's contact line. Mirrors the homepage footer's
 * "Bengaluru, IN" tag.
 */
function LegalFooter() {
  return (
    <footer className="mt-8">
      <div className="tick-divider mb-6" aria-hidden />
      <p className="font-mono text-caption text-muted">
        Draep Technologies Pvt. Ltd. · Bengaluru, India
      </p>
    </footer>
  );
}

/* ─── Building blocks for the page authors ────────────────────────────────── */

/** A numbered, titled section. Renders the number as a mono eyebrow. */
export function Section({
  id,
  number,
  title,
  children,
}: {
  id?: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-card border border-hairline bg-chalk-white p-5 shadow-card">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-eyebrow font-medium text-accent-text">{number}</span>
        <h2 className="font-heading text-h3 font-semibold text-ink-navy">{title}</h2>
      </div>
      <div className="mt-3 space-y-3 text-body leading-relaxed text-ink">{children}</div>
    </section>
  );
}

/** A sub-heading inside a Section (used for 3.1, 4, etc.). */
export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-1 font-heading text-body font-semibold text-ink-navy">{children}</h3>
  );
}

/** A bulleted list with brand tick markers instead of default bullets. */
export function Bullets({
  items,
  className,
}: {
  items: ReactNode[];
  className?: string;
}) {
  return (
    <ul className={clsx("space-y-2", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden
            className="mt-[7px] h-[6px] w-[10px] flex-none rounded-[1px] bg-draep-orange/70"
          />
          <span className="text-body text-ink">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** An ordered list — numbers in mono accent, indented content. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="font-mono text-caption font-medium text-accent-text">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="text-body text-ink">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * LegalTable — two-column reference table (e.g. cancellation matrix, retention
 * schedule). Header row in mist-navy, hairline row dividers, mono where it
 * reads like data.
 */
export function LegalTable({
  head,
  rows,
}: {
  head: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-mist-navy">
            {head.map((h, i) => (
              <th
                key={i}
                className="border-b border-hairline-strong px-3 py-2 font-heading text-caption font-semibold text-ink-navy"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="align-top">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={clsx(
                    "border-b border-hairline px-3 py-2.5 text-caption text-ink last:border-b-0",
                    ci === 0 && "font-medium text-ink-navy",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A short callout — used for grievance officer / key commitment blocks. */
export function Callout({
  children,
  title,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-card border border-hairline-strong bg-warm-sand p-4">
      {title && (
        <p className="font-heading text-body font-semibold text-ink-navy">{title}</p>
      )}
      <div className={clsx("text-body text-ink", title && "mt-1")}>{children}</div>
    </div>
  );
}
