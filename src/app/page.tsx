"use client";

/**
 * Landing — Draep V0.
 *
 * Design intent: lead with the mark and the promise ("Measured for you."),
 * use the Tape Gradient as the hero surface, and let the tick + rivet motifs
 * carry the eye down the page. Every section picks up a Brand Book cue:
 *   - Hero             : reversed primary lockup, Tape Gradient, tick pattern, curl
 *   - Marquee stats    : mono numerals on navy tile (§5 data + §9 social style)
 *   - How it works     : tick-rivet rail (§6 core motif)
 *   - Pricing          : orange totals row, mono numerals (§9 invoices)
 *   - Service area     : soft warm fill, single orange accent
 */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { MonoNumber } from "@/components/ui/MonoNumber";
import {
  Calendar,
  HomeVisit,
  Sparkle,
  Ruler,
  ShieldCheck,
  MapPin,
} from "@/components/ui/icons";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import { DESIGN_ROUTES } from "@/lib/routing";
import { formatPrice } from "@/lib/pricing";
import { BASE_STITCHING } from "@/lib/pricing-config";

export default function LandingPage() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const initDraft = useBookingStore((s) => s.initDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);
  const [navigating, startTransition] = useTransition();

  const hasDraft = Boolean(draft);

  useEffect(() => {
    router.prefetch(DESIGN_ROUTES[0]);
  }, [router]);

  const handleStart = () => {
    if (hasDraft) clearDraft();
    initDraft();
    track({ event: "landing_cta_tapped", resumed: false });
    startTransition(() => {
      router.push(DESIGN_ROUTES[0]);
    });
  };

  const handleResume = () => {
    if (!draft) initDraft();
    track({ event: "landing_cta_tapped", resumed: true });
    startTransition(() => {
      router.push(DESIGN_ROUTES[0]);
    });
  };

  const primaryCta = hasDraft && hydrated
    ? strings.landing.resumeCta
    : strings.landing.primaryCta;
  const primaryHandler = hasDraft && hydrated ? handleResume : handleStart;

  return (
    <main className="min-h-dvh bg-chalk-white">
      {/* ───────── Hero ─────────
          Tape Gradient surface, reversed primary lockup, oversized promise line.
          Tick-pattern overlay + curl ribbon for brand motif density.
      */}
      <section className="relative overflow-hidden bg-tape text-chalk-white">
        {/* Tick pattern overlay — Brand Book §6 core motif */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #FFFFFF 0 2px, transparent 2px 28px)",
          }}
        />
        {/* Curl ribbon — a soft rounded loop in the corner (§6) */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border-[14px] border-chalk-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-64 w-64 rounded-full border-[10px] border-ember/30"
        />

        <div className="column relative flex min-h-[92vh] flex-col px-5 pb-8 pt-5">
          {/* Reversed primary lockup: full-color symbol + white wordmark */}
          <header className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2.5">
              <Image
                src="/logo.png"
                alt=""
                width={40}
                height={40}
                priority
                className="h-10 w-10 flex-none rounded-card object-contain"
              />
              <span
                aria-hidden
                className="font-heading text-[1.75rem] font-bold lowercase leading-none tracking-tight text-chalk-white"
              >
                draep
              </span>
            </span>
            <span className="font-heading text-caption tracking-[0.14em] text-chalk-white/80 uppercase">
              Est. 2026 · Bangalore
            </span>
          </header>

          {/* Promise line — the brand idea, oversized */}
          <div className="mt-auto pt-24">
            <div className="flex items-center gap-2 text-chalk-white/85">
              {/* Tick bullet */}
              <span
                aria-hidden
                className="h-4 w-[3px] rounded-pill bg-chalk-white"
              />
              <span className="font-mono text-caption uppercase tracking-[0.18em]">
                {strings.brand.tagline}
              </span>
            </div>

            <h1 className="mt-4 font-heading text-[2.75rem] font-bold leading-[1.05] tracking-tight text-chalk-white">
              Your blouse,
              <br />
              <span className="relative inline-block">
                <span className="relative z-10">{strings.landing.heroHeadlineHighlight}</span>
                {/* Rivet dot terminates the highlight — §6 */}
                <span
                  aria-hidden
                  className="absolute -right-3 bottom-2 h-2 w-2 rounded-full bg-chalk-white"
                />
              </span>{" "}
              for you.
            </h1>

            <p className="mt-5 max-w-md text-body text-chalk-white/90">
              {strings.landing.heroSubline}
            </p>

            <div className="mt-8 space-y-3">
              <Button
                onClick={primaryHandler}
                loading={navigating}
                fullWidth
                className="bg-chalk-white text-ink-navy hover:bg-chalk-white/95"
              >
                {primaryCta}
              </Button>
              {hasDraft && hydrated && (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={navigating}
                  className="block w-full text-center text-caption text-chalk-white/85 underline-offset-4 hover:text-chalk-white hover:underline disabled:opacity-50"
                >
                  {strings.landing.startOver}
                </button>
              )}
            </div>

            {/* Scroll cue — rivet on a tape-silver line */}
            <div className="mt-12 flex items-center gap-3 text-chalk-white/60">
              <span aria-hidden className="h-px flex-1 bg-chalk-white/25" />
              <span className="h-1.5 w-1.5 rounded-full bg-chalk-white/70" />
              <span className="font-mono text-caption uppercase tracking-[0.18em]">
                Scroll
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Stats marquee ─────────
          Three crisp numbers on Ink Navy tile — Brand Book §9 "social" treatment
          and §5 mono numerals on data. Rivet divider between items.
      */}
      <section className="bg-ink-navy text-chalk-white">
        <div className="column grid grid-cols-3 divide-x divide-chalk-white/10">
          <Stat value="3 hrs" label="Home-visit window" />
          <Stat value="7 days" label="Delivery + trial" />
          <Stat value="100%" label="Fixes on us" />
        </div>
      </section>

      {/* ───────── How it works ───────── */}
      <section className="column py-14">
        <SectionEyebrow label="How it works" />
        <h2 className="mt-3 font-heading text-h1 font-semibold text-ink-navy">
          Design, measure,
          <br />
          wear.
        </h2>

        <ol className="mt-8 space-y-7">
          <Step
            icon={<Sparkle size={20} />}
            stepNumber="01"
            title={strings.landing.how1Title}
            body={strings.landing.how1Body}
          />
          <Step
            icon={<HomeVisit size={20} />}
            stepNumber="02"
            title={strings.landing.how2Title}
            body={strings.landing.how2Body}
          />
          <Step
            icon={<Calendar size={20} />}
            stepNumber="03"
            title={strings.landing.how3Title}
            body={strings.landing.how3Body}
            terminal
          />
        </ol>
      </section>

      {/* ───────── Pillars — warm fill, three big promises ───────── */}
      <section className="bg-warm-bg py-14">
        <div className="column">
          <SectionEyebrow label="Why Draep" />
          <h2 className="mt-3 font-heading text-h1 font-semibold text-ink-navy">
            Three things we
            <br />
            won't compromise.
          </h2>

          <div className="mt-8 space-y-3">
            <PillarCard
              icon={<Ruler size={22} />}
              title="Precision"
              body="Measured by SOP, stored forever. Your fit is a vault, not a guess."
            />
            <PillarCard
              icon={<ShieldCheck size={22} />}
              title="Trust"
              body="Transparent pricing, written SLAs, and the Draep Protection Policy."
            />
            <PillarCard
              icon={<Sparkle size={22} />}
              title="Craftsmanship"
              body="Master tailors celebrated and paid fairly — never hidden, never replaced."
            />
          </div>
        </div>
      </section>

      {/* ───────── Pricing ─────────
          Navy tile, mono numerals, orange totals row — §9 invoices/rate cards.
      */}
      <section className="bg-ink-navy py-14 text-chalk-white">
        <div className="column">
          <SectionEyebrow label="Transparent pricing" reversed />
          <h2 className="mt-3 font-heading text-h1 font-semibold">
            No surprises,
            <br />
            ever.
          </h2>
          <p className="mt-4 max-w-md text-body text-chalk-white/80">
            {strings.landing.rateTeaserBody}
          </p>

          {/* Rate card — orange totals row (§9) */}
          <div className="mt-6 overflow-hidden rounded-card bg-chalk-white text-ink-navy shadow-brand">
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-caption font-medium uppercase tracking-wider text-ink-navy/55">
                  Base stitching from
                </p>
                <p className="mt-1 text-caption text-ink-navy/70">
                  Fabric & add-ons billed at cost
                </p>
              </div>
              <MonoNumber className="text-h1 font-semibold text-draep-orange">
                {formatPrice(BASE_STITCHING)}
              </MonoNumber>
            </div>
            <div
              aria-hidden
              className="h-px bg-tape-silver"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #D8D8D8 0 8px, transparent 8px 16px)",
              }}
            />
            <div className="flex items-center justify-between bg-orange-fill px-5 py-3">
              <span className="font-heading text-h3 font-semibold text-ink-navy">
                Every choice priced up front
              </span>
              <span className="font-mono text-caption font-medium text-ink-navy/70">
                ₹ · in + cm
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Service area ───────── */}
      <section className="column py-14">
        <SectionEyebrow label="Now serving" />
        <h2 className="mt-3 font-heading text-h1 font-semibold text-ink-navy">
          Bangalore, to
          <br />
          start.
        </h2>
        <div className="mt-6 flex items-start gap-3 rounded-card border border-tape-silver bg-chalk-white p-4 shadow-brand">
          <span className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-pill bg-orange-fill text-draep-orange">
            <MapPin size={18} />
          </span>
          <div>
            <p className="font-heading text-h3 font-semibold text-ink-navy">
              Harlur · HSR · Sarjapur · Kasavanahalli
            </p>
            <p className="mt-1 text-body text-ink-navy/70">
              More neighborhoods added every month — leave your pincode on the next step to be notified.
            </p>
          </div>
        </div>
      </section>

      {/* ───────── Closing band ─────────
          Tape Gradient reprise, big promise + CTA.
      */}
      <section className="relative overflow-hidden bg-tape px-5 py-16 text-center text-chalk-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #FFFFFF 0 2px, transparent 2px 28px)",
          }}
        />
        <div className="relative">
          <span className="font-mono text-caption uppercase tracking-[0.18em] text-chalk-white/85">
            {strings.brand.tagline}
          </span>
          <h2 className="mx-auto mt-3 max-w-md font-heading text-h1 font-bold leading-tight">
            Begin your draft in under a minute.
          </h2>
          <div className="mx-auto mt-6 max-w-sm">
            <Button
              onClick={primaryHandler}
              loading={navigating}
              fullWidth
              className="bg-chalk-white text-ink-navy hover:bg-chalk-white/95"
            >
              {primaryCta}
            </Button>
          </div>
          {/* Rivet terminator */}
          <div className="mt-10 flex items-center justify-center gap-2 text-chalk-white/60">
            <span aria-hidden className="h-px w-8 bg-chalk-white/30" />
            <span className="h-1.5 w-1.5 rounded-full bg-chalk-white/70" />
            <span aria-hidden className="h-px w-8 bg-chalk-white/30" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink-navy px-5 py-8 text-chalk-white/70">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Draep"
            width={24}
            height={24}
            className="h-6 w-6 rounded object-contain"
          />
          <span className="font-heading text-caption font-bold lowercase tracking-tight text-chalk-white">
            draep
          </span>
          <span className="ml-auto font-mono text-caption text-chalk-white/50">
            © 2026
          </span>
        </div>
      </footer>
    </main>
  );
}

/* ───────── Building blocks ───────── */

function SectionEyebrow({
  label,
  reversed = false,
}: {
  label: string;
  reversed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="h-3.5 w-[3px] rounded-pill bg-draep-orange"
      />
      <span
        className={`font-mono text-caption uppercase tracking-[0.18em] ${
          reversed ? "text-chalk-white/85" : "text-draep-orange"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-3 py-7 text-center">
      <MonoNumber className="block text-h2 font-semibold text-chalk-white">
        {value}
      </MonoNumber>
      <p className="mt-1 text-caption text-chalk-white/65">{label}</p>
    </div>
  );
}

interface StepProps {
  icon: React.ReactNode;
  stepNumber: string;
  title: string;
  body: string;
  terminal?: boolean;
}

function Step({ icon, stepNumber, title, body, terminal }: StepProps) {
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-pill border-2 border-draep-orange bg-orange-fill text-draep-orange">
          {icon}
        </span>
        {!terminal && (
          <span
            aria-hidden
            className="mt-1 w-px flex-1 bg-tape-silver"
            style={{ minHeight: 20 }}
          />
        )}
        {terminal && (
          <span
            aria-hidden
            className="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-draep-orange"
          />
        )}
      </div>
      <div className="pb-2">
        <p className="font-mono text-caption text-ink-navy/55">{stepNumber}</p>
        <h3 className="font-heading text-h3 font-semibold text-ink-navy">{title}</h3>
        <p className="mt-1 text-body text-ink-navy/75">{body}</p>
      </div>
    </li>
  );
}

function PillarCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-card border border-tape-silver bg-chalk-white p-4 shadow-brand">
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-pill bg-tape text-chalk-white">
        {icon}
      </span>
      <div className="flex-1">
        <h3 className="font-heading text-h3 font-semibold text-ink-navy">{title}</h3>
        <p className="mt-1 text-body text-ink-navy/75">{body}</p>
      </div>
    </div>
  );
}
