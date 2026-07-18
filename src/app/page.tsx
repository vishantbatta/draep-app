"use client";

/**
 * Draep landing page — pixel-perfect port of draep.html.
 *
 * Desktop + mobile responsive layout (max-w-1120). All "Book now" CTAs
 * deep-link to WhatsApp with a pre-drafted message to +91 81474 97006.
 * Scroll reveal animations are wired via IntersectionObserver on .lp-reveal.
 */

import { useEffect } from "react";

// WhatsApp booking constants (mirror draep.html).
const WA_PHONE = "918147497006";
const WA_MESSAGE =
  "Hi Draep! 👋 I'd like to book a free at-home visit for blouse stitching. Please help me get started.";
const WA_URL = `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(WA_MESSAGE)}`;

// WhatsApp glyph (24x24 filled path — identical across hero and final CTA).
const WhatsAppIcon = ({ fill = "#fff" }: { fill?: string }) => (
  <svg
    className="h-[18px] w-[18px] shrink-0"
    viewBox="0 0 24 24"
    fill={fill}
    aria-hidden="true"
  >
    <path d="M17.5 14.4c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35zM12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.06L2 22l5.06-1.33A9.94 9.94 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" />
  </svg>
);

// Checkmark tick used in hero assurance row and pricing list.
const TickIcon = ({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) => (
  <svg
    className={`shrink-0 ${className}`}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M20 6L9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function LandingPage() {
  // Scroll reveal — IntersectionObserver with 1.4s safety fallback.
  useEffect(() => {
    const reveals = Array.from(
      document.querySelectorAll<HTMLElement>(".lp-reveal"),
    );

    const showAll = () => reveals.forEach((el) => el.classList.add("lp-in"));

    if (typeof IntersectionObserver === "undefined") {
      showAll();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("lp-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    reveals.forEach((el) => io.observe(el));

    // Safety fallback: ensure everything is visible even if scroll events never fire.
    const t = setTimeout(showAll, 1400);

    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, []);

  return (
    <main id="top" className="block">
      {/* ============ STICKY HEADER NAV ============ */}
      <header
        className="sticky top-0 z-50"
        style={{
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          background: "rgba(255, 251, 244, 0.82)",
          borderBottom: "1px solid rgba(8, 48, 104, 0.07)",
        }}
      >
        <div className="lp-wrap flex h-[70px] items-center justify-between">
          <a href="#top" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-lockup.png"
              alt="draep"
              className="block h-[34px] w-auto"
            />
          </a>
          <nav className="flex items-center gap-[30px]">
            <a
              href="#how"
              className="hidden text-[14.5px] font-medium text-[#3A5C8F] transition-colors hover:text-[var(--ink-navy)] md:inline-block"
            >
              How it works
            </a>
            <a
              href="#why"
              className="hidden text-[14.5px] font-medium text-[#3A5C8F] transition-colors hover:text-[var(--ink-navy)] md:inline-block"
            >
              Why Draep
            </a>
            <a
              href="#pricing"
              className="hidden text-[14.5px] font-medium text-[#3A5C8F] transition-colors hover:text-[var(--ink-navy)] md:inline-block"
            >
              Pricing
            </a>
            <a
              href={WA_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-[48px] items-center gap-[9px] rounded-pill bg-tape px-[26px] py-[14px] font-heading text-[15px] font-semibold text-white transition-all duration-200 ease-brand hover:-translate-y-[2px] active:translate-y-0 active:bg-ember"
              style={{ boxShadow: "0 8px 22px rgba(208, 96, 16, 0.32)" }}
            >
              <WhatsAppIcon />
              Book now
            </a>
          </nav>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden py-[66px] md:pb-[40px]">
        <div className="lp-wrap grid items-center gap-[48px] [grid-template-columns:1.05fr_0.95fr] max-[860px]:grid-cols-1 max-[860px]:gap-[30px]">
          {/* Hero copy */}
          <div>
            <span className="mb-[22px] inline-flex items-center gap-[9px] rounded-pill bg-[var(--orange-fill)] px-[14px] py-[7px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--ember)]">
              <span className="h-[7px] w-[7px] rounded-full bg-[var(--draep-orange)]" />
              At-home blouse tailoring · Bengaluru
            </span>
            <h1 className="font-heading font-bold leading-[1.12] tracking-[-0.01em] text-[var(--ink-navy)] [font-size:clamp(40px,6vw,64px)]">
              Measured <span className="text-[var(--draep-orange)]">for you.</span>
              <br />
              Stitched to perfection.
            </h1>
            <p className="mt-[22px] mb-[32px] max-w-[30ch] text-[18px] leading-[1.55] text-[#3A5C8F] max-[860px]:max-w-none">
              A trained Style Captain visits your home, measures you precisely,
              and helps you design the perfect blouse. We handle the tailoring,
              trials, and delivery — end to end.
            </p>
            <div className="flex flex-wrap items-center gap-[14px]">
              <a
                href={WA_URL}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-[48px] items-center gap-[9px] rounded-pill bg-tape px-[26px] py-[14px] font-heading text-[15px] font-semibold text-white transition-all duration-200 ease-brand hover:-translate-y-[2px] active:translate-y-0 active:bg-ember"
                style={{ boxShadow: "0 8px 22px rgba(208, 96, 16, 0.32)" }}
              >
                <WhatsAppIcon />
                Book now
              </a>
              <a
                href="#how"
                className="inline-flex min-h-[48px] items-center gap-[9px] rounded-pill border-[1.5px] border-[rgba(8,48,104,0.22)] bg-transparent px-[26px] py-[14px] font-heading text-[15px] font-semibold text-[var(--ink-navy)] transition-colors hover:border-[var(--ink-navy)] hover:bg-[rgba(8,48,104,0.04)]"
              >
                See how it works
              </a>
            </div>
            <div className="mt-[30px] flex flex-wrap gap-[22px]">
              <span className="flex items-center gap-[9px] text-[13.5px] font-medium text-[#3A5C8F]">
                <TickIcon className="text-[var(--draep-orange)]" /> Free home
                visit
              </span>
              <span className="flex items-center gap-[9px] text-[13.5px] font-medium text-[#3A5C8F]">
                <TickIcon className="text-[var(--draep-orange)]" /> Transparent
                pricing
              </span>
              <span className="flex items-center gap-[9px] text-[13.5px] font-medium text-[#3A5C8F]">
                <TickIcon className="text-[var(--draep-orange)]" /> Fabric
                protected in writing
              </span>
            </div>
          </div>

          {/* Hero visual */}
          <div className="relative h-[440px] max-[860px]:order-[-1] max-[860px]:h-[360px]">
            <div
              className="absolute inset-0 overflow-hidden rounded-[28px]"
              style={{
                background:
                  "radial-gradient(120% 120% at 80% 10%, #FFF0DA 0%, #FDE3BF 46%, #F7CE93 100%)",
                boxShadow:
                  "0 1px 2px rgba(8,48,104,.05), 0 12px 40px rgba(8,48,104,.08)",
              }}
            >
              <div
                className="absolute right-[-70px] bottom-[-90px] h-[340px] w-[340px] rounded-full"
                style={{ border: "38px solid rgba(248,144,16,.16)" }}
              />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/tape-symbol.png"
              alt=""
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-auto w-[230px] -translate-x-1/2 -translate-y-1/2 object-contain"
              style={{ filter: "drop-shadow(0 12px 26px rgba(208,96,16,.22))" }}
            />
            {/* Floating card 1 — Perfect fit */}
            <div
              className="lp-float absolute left-[-14px] top-[26px] flex items-center gap-[12px] rounded-[14px] bg-white p-[14px] max-[860px]:left-[4px]"
              style={{
                boxShadow:
                  "0 1px 2px rgba(8,48,104,.05), 0 12px 40px rgba(8,48,104,.08)",
              }}
            >
              <div
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]"
                style={{ background: "var(--navy-bg)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M20 6L9 17l-5-5"
                    stroke="#083068"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <div className="text-[12px] font-medium leading-[1.2] text-[#7C8AA5]">
                  Perfect fit
                </div>
                <div className="font-heading text-[15px] font-semibold leading-[1.25] text-[var(--ink-navy)]">
                  First-trial ready
                </div>
              </div>
            </div>
            {/* Floating card 2 — Price */}
            <div
              className="lp-float-2 absolute bottom-[34px] right-[-10px] flex items-center gap-[12px] rounded-[14px] bg-white p-[14px] max-[860px]:right-[4px]"
              style={{
                boxShadow:
                  "0 1px 2px rgba(8,48,104,.05), 0 12px 40px rgba(8,48,104,.08)",
              }}
            >
              <div
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]"
                style={{ background: "var(--orange-fill)" }}
              >
                <span
                  className="font-mono font-semibold text-[var(--ember)]"
                  aria-hidden="true"
                >
                  ₹
                </span>
              </div>
              <div>
                <div className="text-[12px] font-medium leading-[1.2] text-[#7C8AA5]">
                  Blouse stitching from
                </div>
                <div className="font-mono font-heading text-[15px] font-semibold leading-[1.25] text-[var(--ink-navy)]">
                  ₹749
                </div>
              </div>
            </div>
            {/* Floating card 3 — Trial */}
            <div
              className="lp-float-3 absolute bottom-[120px] left-[-24px] flex items-center gap-[12px] rounded-[14px] bg-white p-[14px] max-[860px]:left-0"
              style={{
                boxShadow:
                  "0 1px 2px rgba(8,48,104,.05), 0 12px 40px rgba(8,48,104,.08)",
              }}
            >
              <div
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px]"
                style={{ background: "var(--navy-bg)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 7v5l3 2"
                    stroke="#083068"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="9" stroke="#083068" strokeWidth="2" />
                </svg>
              </div>
              <div>
                <div className="text-[12px] font-medium leading-[1.2] text-[#7C8AA5]">
                  Ready for trial
                </div>
                <div className="font-heading text-[15px] font-semibold leading-[1.25] text-[var(--ink-navy)]">
                  Sat, 6–9 PM
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TAPE DIVIDER ============ */}
      <div className="lp-tape-strip" aria-hidden="true" />

      {/* ============ HOW IT WORKS ============ */}
      <section id="how" className="py-[84px]">
        <div className="lp-wrap">
          <div className="lp-reveal mb-[52px] max-w-[640px]">
            <div className="mb-[14px] flex items-center gap-[10px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[var(--draep-orange)]">
              <span className="inline-block h-[2px] w-[26px] bg-[var(--draep-orange)]" />
              How it works
            </div>
            <h2 className="font-heading font-bold leading-[1.12] tracking-[-0.01em] text-[var(--ink-navy)] [font-size:clamp(28px,4vw,40px)]">
              Bespoke, without leaving home
            </h2>
            <p className="mt-[16px] text-[17px] leading-[1.55] text-[#3A5C8F]">
              Four simple steps. Zero guesswork. Your Style Captain does the
              hard part.
            </p>
          </div>
          <div className="relative grid grid-cols-4 gap-[22px] max-[820px]:grid-cols-2 max-[820px]:gap-[30px] max-[460px]:grid-cols-1">
            {/* dashed connector line — hide on mobile */}
            <div
              className="absolute left-[6%] right-[6%] top-[26px] z-0 hidden h-[2px] md:block"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, var(--tape-silver) 0 2px, transparent 2px 12px)",
              }}
              aria-hidden="true"
            />
            {[
              {
                num: "01",
                title: "Book a visit",
                body: "Tap Book now and pick a 3-hour slot. The home visit is free, always.",
              },
              {
                num: "02",
                title: "Get measured",
                body: "Your Style Captain measures you by SOP and helps you design your blouse.",
              },
              {
                num: "03",
                title: "We tailor it",
                body: "A master tailor stitches your fabric to spec, with quality checks at every stage.",
              },
              {
                num: "04",
                title: "Trial & deliver",
                body: "We deliver for trial. Not perfect? We alter until the fit is right.",
              },
            ].map((s) => (
              <div key={s.num} className="lp-reveal relative z-[1]">
                <div
                  className="mb-[20px] grid h-[54px] w-[54px] place-items-center rounded-full border-2 border-[var(--draep-orange)] bg-white font-mono text-[18px] font-semibold text-[var(--ember)]"
                  style={{
                    boxShadow:
                      "0 1px 2px rgba(8,48,104,.05), 0 6px 18px rgba(8,48,104,.06)",
                  }}
                >
                  {s.num}
                </div>
                <h3 className="mb-[8px] font-heading text-[18px] font-semibold text-[var(--ink-navy)]">
                  {s.title}
                </h3>
                <p className="text-[14.5px] leading-[1.55] text-[#5A6B87]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY DRAEP ============ */}
      <section id="why" className="bg-[var(--ink-navy)] py-[84px] text-white">
        <div className="lp-wrap">
          <div className="lp-reveal mb-[52px] max-w-[640px]">
            <div className="mb-[14px] flex items-center gap-[10px] font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[var(--draep-orange)]">
              <span className="inline-block h-[2px] w-[26px] bg-[var(--draep-orange)]" />
              Why Draep
            </div>
            <h2 className="font-heading font-bold leading-[1.12] tracking-[-0.01em] text-white [font-size:clamp(28px,4vw,40px)]">
              The infrastructure tailoring never had
            </h2>
            <p
              className="mt-[16px] text-[17px] leading-[1.55]"
              style={{ color: "rgba(255,255,255,.72)" }}
            >
              No more paper slips, lost measurements, or verbal promises. Just
              precision, kept in writing.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-[20px] max-[820px]:grid-cols-1">
            <div
              className="lp-reveal rounded-[16px] p-[28px_24px] transition-all duration-200 ease-brand hover:-translate-y-[4px]"
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
              }}
            >
              <div
                className="mb-[18px] grid h-[48px] w-[48px] place-items-center rounded-[12px] bg-tape"
                aria-hidden="true"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 7h16M4 12h16M4 17h16"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="7" r="1.6" fill="#fff" />
                  <circle cx="15" cy="12" r="1.6" fill="#fff" />
                  <circle cx="10" cy="17" r="1.6" fill="#fff" />
                </svg>
              </div>
              <h3 className="mb-[9px] font-heading text-[18px] font-semibold text-white">
                Measured once, remembered forever
              </h3>
              <p
                className="text-[14.5px] leading-[1.55]"
                style={{ color: "rgba(255,255,255,.72)" }}
              >
                Your measurements are taken by a precise SOP and stored in your
                digital vault — never re-measured from scratch.
              </p>
            </div>
            <div
              className="lp-reveal rounded-[16px] p-[28px_24px] transition-all duration-200 ease-brand hover:-translate-y-[4px]"
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
              }}
            >
              <div
                className="mb-[18px] grid h-[48px] w-[48px] place-items-center rounded-[12px] bg-tape"
                aria-hidden="true"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 12l2 2 4-4"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="mb-[9px] font-heading text-[18px] font-semibold text-white">
                Your fabric, protected
              </h3>
              <p
                className="text-[14.5px] leading-[1.55]"
                style={{ color: "rgba(255,255,255,.72)" }}
              >
                Every order is covered by the Draep Protection Policy. If
                something goes wrong, it&apos;s handled — in writing, not with a
                shrug.
              </p>
            </div>
            <div
              className="lp-reveal rounded-[16px] p-[28px_24px] transition-all duration-200 ease-brand hover:-translate-y-[4px]"
              style={{
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(255,255,255,.12)",
              }}
            >
              <div
                className="mb-[18px] grid h-[48px] w-[48px] place-items-center rounded-[12px] bg-tape"
                aria-hidden="true"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
                  <path
                    d="M12 7v5l3 2"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h3 className="mb-[9px] font-heading text-[18px] font-semibold text-white">
                Real timelines, real prices
              </h3>
              <p
                className="text-[14.5px] leading-[1.55]"
                style={{ color: "rgba(255,255,255,.72)" }}
              >
                Transparent pricing before you commit and a delivery date you
                can hold us to — “ready Saturday,” not “soon.”
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section id="pricing" className="py-[84px]">
        <div className="lp-wrap">
          <div
            className="lp-reveal grid items-center gap-[40px] rounded-[22px] p-[44px_46px] max-[820px]:grid-cols-1 max-[820px]:gap-[28px] max-[820px]:p-[34px_26px]"
            style={{
              gridTemplateColumns: "1.1fr 0.9fr",
              background: "var(--warm-bg)",
              border: "1px solid rgba(8, 48, 104, 0.08)",
            }}
          >
            <div>
              <div className="font-mono text-[15px] font-semibold text-[var(--ember)]">
                Simple, upfront pricing
              </div>
              <div className="my-[6px] font-heading font-bold leading-none text-[var(--ink-navy)] [font-size:clamp(38px,6vw,58px)]">
                ₹749{" "}
                <span className="text-[20px] font-semibold text-[#7C8AA5]">
                  / blouse
                </span>
              </div>
              <p className="text-[14.5px] text-[#5A6B87]">
                Starting price for a standard blouse stitch. Add-ons like
                piping, lining, and latkans are priced clearly before you
                confirm — no surprises.
              </p>
            </div>
            <ul className="grid list-none gap-[14px]">
              {[
                "Free at-home measurement & styling",
                "Pickup, trials & delivery included",
                "Alterations until the fit is right",
                "Serving Harlur, HSR, Sarjapur & Kasavanahalli",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-[12px] text-[15px] font-medium text-[var(--ink-navy)]"
                >
                  <TickIcon
                    size={18}
                    className="mt-[2px] text-[var(--draep-orange)]"
                  />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section
        className="relative overflow-hidden bg-tape py-[78px] text-center text-white"
        style={{ padding: "78px 24px" }}
      >
        {/* decorative circles */}
        <div
          className="absolute left-[-60px] top-[-120px] h-[280px] w-[280px] rounded-full"
          style={{ border: "40px solid rgba(255,255,255,.10)" }}
          aria-hidden="true"
        />
        <div
          className="absolute bottom-[-110px] right-[-40px] h-[220px] w-[220px] rounded-full"
          style={{ border: "40px solid rgba(255,255,255,.10)" }}
          aria-hidden="true"
        />
        <h2 className="relative mx-auto max-w-[16ch] font-heading font-bold [font-size:clamp(30px,5vw,46px)]">
          Your perfect blouse is one message away
        </h2>
        <p className="relative mx-auto mt-[18px] mb-[30px] max-w-[44ch] text-[17px] text-white/90">
          Book a free home visit today. We&apos;ll take it from there.
        </p>
        <a
          href={WA_URL}
          target="_blank"
          rel="noopener"
          className="relative inline-flex min-h-[48px] items-center gap-[9px] rounded-pill bg-white px-[26px] py-[14px] font-heading text-[15px] font-semibold text-[var(--ember)] transition-all duration-200 ease-brand hover:-translate-y-[2px]"
          style={{ boxShadow: "0 10px 30px rgba(0,0,0,.18)" }}
        >
          <WhatsAppIcon fill="#D06010" />
          Book now on WhatsApp
        </a>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="bg-[var(--ink-navy)] py-[44px] text-white/70">
        <div className="lp-wrap flex flex-wrap items-center justify-between gap-[20px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tape-symbol.png"
            alt="draep"
            className="h-[42px] w-auto flex-none"
          />
          <div className="font-mono text-[12.5px] text-white/50">
            Custom tailoring infrastructure · Bengaluru, IN
          </div>
        </div>
      </footer>
    </main>
  );
}
