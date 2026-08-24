"use client";

/**
 * Paying — the post-Cashfree loading page (order-page "Pay ₹X to Book").
 *
 * The customer lands here the moment the Cashfree modal closes. We don't
 * trust what the modal said — we poll the backend, which itself checks the
 * gateway (and the webhook may already have flipped the ledger). The order
 * only reads as confirmed once the server says the money is captured.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { ScreenShell } from "@/components/layout/ScreenShell";
import { Button } from "@/components/ui/Button";
import { Check } from "@/components/ui/icons";
import { checkoutApi } from "@/lib/api";
import { strings } from "@/lib/strings";

type Phase = "checking" | "success" | "failed";

const POLL_INTERVAL_MS = 2500;
const MAX_ATTEMPTS = 24; // ~1 minute before we stop and let the user retry

export default function PayingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");

  // The poll loop. One immediate check first (the webhook often wins the
  // race), then spaced retries. Transient network errors keep polling.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      try {
        const status = await checkoutApi.getVerifiedPaymentStatus(id);
        if (cancelled) return;
        const paid =
          status.payment_status === "paid" ||
          (status.balance_due != null && status.balance_due <= 0);
        if (paid) {
          setPhase("success");
          return;
        }
      } catch {
        // Gateway/BE hiccup — keep waiting while attempts remain.
      }
      if (cancelled) return;
      if (attempts >= MAX_ATTEMPTS) {
        setPhase("failed");
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  // Success is a moment, not a destination — show it, then land on the
  // (now paid) order page.
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => router.replace(`/app/orders/${id}`), 1800);
    return () => clearTimeout(t);
  }, [phase, id, router]);

  const copy =
    phase === "success"
      ? { eyebrow: strings.payConfirm.successEyebrow, title: strings.payConfirm.successTitle, body: strings.payConfirm.successBody }
      : phase === "failed"
        ? { eyebrow: strings.payConfirm.failedEyebrow, title: strings.payConfirm.failedTitle, body: strings.payConfirm.failedBody }
        : { eyebrow: strings.payConfirm.eyebrow, title: strings.payConfirm.checkingTitle, body: strings.payConfirm.checkingBody };

  return (
    <ScreenShell className="flex flex-col items-center justify-center px-6 text-center">
      {/* Status mark */}
      <div
        aria-hidden
        className={
          phase === "success"
            ? "flex h-16 w-16 items-center justify-center rounded-pill bg-draep-orange/15 text-draep-orange"
            : phase === "failed"
              ? "flex h-16 w-16 items-center justify-center rounded-pill bg-draep-orange/10 text-draep-orange"
              : "relative flex h-16 w-16 items-center justify-center"
        }
      >
        {phase === "success" ? (
          <Check size={30} strokeWidth={2.5} />
        ) : phase === "failed" ? (
          <span className="font-heading text-h2 leading-none">!</span>
        ) : (
          <>
            <span className="absolute inset-0 animate-ping rounded-pill bg-navy-interactive/10" />
            <span className="h-8 w-8 animate-spin rounded-pill border-[3px] border-navy-interactive/20 border-t-navy-interactive" />
          </>
        )}
      </div>

      <p className="eyebrow mt-6">{copy.eyebrow}</p>
      <h1 className="mt-1 font-heading text-h1 text-ink-navy">
        {copy.title}
      </h1>
      <p className="mt-2 max-w-[36ch] text-body text-muted">{copy.body}</p>

      {phase === "failed" && (
        <Button
          fullWidth
          className="mt-8"
          onClick={() => router.replace(`/app/orders/${id}`)}
        >
          {strings.payConfirm.backToOrder}
        </Button>
      )}

      {phase === "success" && (
        <Button
          fullWidth
          className="mt-8"
          onClick={() => router.replace(`/app/orders/${id}`)}
        >
          {strings.payConfirm.viewOrder}
        </Button>
      )}
    </ScreenShell>
  );
}
