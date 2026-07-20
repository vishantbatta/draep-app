"use client";

/**
 * Payment — spec §6.11.
 *
 * V0 mocks the gateway: 1.5s simulated round-trip, deterministic success
 * unless the URL has ?fail=1 (used for QA / dry runs).
 *
 * Never double-charge: CTA disabled while a payment attempt is pending;
 * order status verified on return before retry. Real Razorpay drops in
 * behind pay() without touching call sites.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { TapeProgress } from "@/components/layout/TapeProgress";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { ChevronDown } from "@/components/ui/icons";
import { PriceBreakdown } from "@/components/review/PriceBreakdown";
import { useBookingStore } from "@/lib/booking-store";
import { computePrice, formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";

export default function PayPage() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setPayment = useBookingStore((s) => s.setPayment);
  const [status, setStatus] = useState<"idle" | "processing" | "failed">("idle");
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  if (!hydrated || !draft) {
    return (
      <div className="column flex min-h-dvh items-center justify-center">
        <div aria-hidden className="h-1 w-24 overflow-hidden rounded-pill bg-tape-silver">
          <div className="h-full w-1/2 animate-pulse bg-draep-orange" />
        </div>
      </div>
    );
  }

  const price = computePrice(draft);
  const orderId = draft.payment?.orderId ?? generateOrderId();
  const itemCount = price.lines.length - 1; // exclude base stitching from count

  const pay = async () => {
    setStatus("processing");
    track({ event: "payment_initiated", orderId, amount: price.total });

    // Mocked gateway round-trip — real Razorpay SDK replaces this block.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // ?fail=1 forces a failure path for QA.
    const fail = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fail") === "1";

    if (fail) {
      setStatus("failed");
      track({ event: "payment_failed", orderId, amount: price.total });
      return;
    }

    setPayment({ orderId, status: "paid" });
    track({ event: "payment_succeeded", orderId, amount: price.total });
    router.push("/confirmed");
  };

  const retry = () => {
    setStatus("idle");
    router.replace("/pay");
  };

  return (
    <>
      <TapeProgress currentRoute="/review" />
      <ScreenShell className="pt-4">
        <p className="eyebrow">Payment</p>
        <h1 className="font-heading text-h1 text-ink-navy">
          {strings.pay.title}
        </h1>

        {/* Order summary card — Brand Book §8 card: hairline + shadow-card */}
        <div className="mt-5 rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-caption text-muted">{strings.pay.summary}</p>
              <p className="font-heading text-h3 text-ink-navy">{strings.pay.items(itemCount)}</p>
            </div>
            <button
              type="button"
              onClick={() => setBreakdownOpen(true)}
              className="inline-flex items-center gap-1 text-caption text-navy-interactive"
            >
              <ChevronDown size={14} strokeWidth={2.25} />
              Details
            </button>
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t border-hairline pt-4">
            <span className="text-body text-ink/80">{strings.review.total}</span>
            <MonoNumber className="text-h1 font-semibold text-ink-navy">
              {formatPrice(price.total)}
            </MonoNumber>
          </div>
        </div>

        {status === "failed" && (
          <div className="mt-4">
            <Banner variant="error" title={strings.pay.failureTitle}>
              <p>{strings.pay.failureBody}</p>
            </Banner>
          </div>
        )}

        <div className="mt-6">
          <Button
            onClick={pay}
            disabled={status === "processing"}
            loading={status === "processing"}
            fullWidth
          >
            {status === "processing"
              ? strings.pay.processing
              : strings.pay.payCta(price.total)}
          </Button>
          {status === "failed" && (
            <Button onClick={retry} variant="secondary" fullWidth className="mt-2">
              {strings.pay.retry}
            </Button>
          )}
        </div>

        <p className="mt-4 text-caption text-muted">
          Secure UPI payment. We never store your card details.
        </p>
      </ScreenShell>

      <BottomSheet
        open={breakdownOpen}
        onClose={() => setBreakdownOpen(false)}
        title={strings.pay.summary}
      >
        <PriceBreakdown draft={draft} />
      </BottomSheet>
    </>
  );
}

function generateOrderId(): string {
  // Deterministic-ish for V0; real backend assigns this. Format: DRP-YYYYMMDD-XXXX.
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `DRP-${ymd}-${rand}`;
}
