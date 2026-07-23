"use client";

/**
 * Payment — spec §6.11 + Cashfree integration (spec S10).
 *
 * Flow:
 *   1. POST /orders/{id}/validate — pre-checkout validation
 *   2. POST /orders/{id}/checkout with Idempotency-Key → get Cashfree session
 *   3. Load Cashfree SDK → open payment session (redirect or popup)
 *   4. On callback: POST /orders/{id}/checkout/verify with signature
 *   5. Poll GET /orders/{id}/status as fallback for webhook delays
 *
 * Idempotency: UUID generated per payment attempt. Double-tap is safe.
 * Mock mode: If backend returns no payment_session_id, falls back to
 * the V0 simulated gateway (1.5s delay, ?fail=1 for QA).
 */

import { useState, useRef, useEffect } from "react";
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
import { ordersApi, checkoutApi } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import type { OrderStatusOut } from "@/types/api";

type PayStatus = "idle" | "validating" | "processing" | "verifying" | "failed";

export default function PayPage() {
  const router = useRouter();
  const draft = useBookingStore((s) => s.draft);
  const hydrated = useBookingStore((s) => s.hydrated);
  const setPayment = useBookingStore((s) => s.setPayment);
  const [status, setStatus] = useState<PayStatus>("idle");
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const idempotencyRef = useRef<string | null>(null);

  // If we arrive without an orderId, call initDraft() which will create
  // the server-side order while preserving existing local selections.
  useEffect(() => {
    if (hydrated && draft && !draft.orderId && !recovering) {
      setRecovering(true);
      useBookingStore.getState().initDraft().finally(() => setRecovering(false));
    }
  }, [hydrated, draft, recovering]);

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
  const itemCount = price.lines.length - 1;

  const pay = async () => {
    if (!draft.orderId) {
      setError("We're setting up your order. Please wait a moment and try again.");
      return;
    }

    setError(null);
    setStatus("validating");

    // Step 1: Validate the order before checkout
    try {
      const validation = await ordersApi.validateOrder(draft.orderId);
      if (!validation.valid) {
        const messages = validation.issues.map((i) => i.message).join("; ");
        setError(messages || "Please complete your design before paying.");
        setStatus("failed");
        return;
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Validation failed. Try again.",
      );
      setStatus("failed");
      return;
    }

    // Step 2: Checkout → Cashfree init
    setStatus("processing");
    const idempotencyKey = crypto.randomUUID();
    idempotencyRef.current = idempotencyKey;

    track({ event: "payment_initiated", orderId: draft.orderId, amount: price.total });

    let checkoutResult;
    try {
      checkoutResult = await checkoutApi.checkout(
        draft.orderId,
        { advance_policy: "advance_only" },
        idempotencyKey,
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Payment initiation failed. Try again.",
      );
      setStatus("failed");
      track({ event: "payment_failed", orderId: draft.orderId, amount: price.total });
      return;
    }

    // Step 3: Check if we have a real Cashfree session
    const cashfreeSession = checkoutResult.cashfree?.payment_session_id;

    if (!cashfreeSession) {
      // Mock mode (no Cashfree credentials configured on backend)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const fail =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("fail") === "1";

      if (fail) {
        setStatus("failed");
        track({ event: "payment_failed", orderId: draft.orderId, amount: price.total });
        return;
      }

      setPayment({ orderId: draft.orderId, status: "paid" });
      track({ event: "payment_succeeded", orderId: draft.orderId, amount: price.total });
      router.push("/confirmed");
      return;
    }

    // Real Cashfree flow
    try {
      const cashfree = await loadCashfreeSDK();
      setStatus("verifying");

      await cashfree.checkout({
        paymentSessionId: cashfreeSession,
        redirectTarget: "_modal",
      });

      // After Cashfree modal closes, verify the payment
      const cashfreeOrderId = checkoutResult.cashfree?.order_id ?? "";
      const cashfreePaymentId = cashfreeSession;
      const cashfreeSignature = "";

      try {
        const verifyResult = await checkoutApi.verifyCheckout(draft.orderId, {
          cashfree_order_id: cashfreeOrderId,
          cashfree_payment_id: cashfreePaymentId,
          cashfree_signature: cashfreeSignature,
        });

        if (
          verifyResult.payment_status === "paid" ||
          verifyResult.fulfillment_status === "awaiting_visit"
        ) {
          setPayment({ orderId: draft.orderId, status: "paid" });
          track({ event: "payment_succeeded", orderId: draft.orderId, amount: price.total });
          router.push("/confirmed");
          return;
        }
      } catch {
        // Verification might fail if webhook hasn't processed yet — poll
      }

      // Step 5: Poll order status as fallback
      const orderStatus = await pollOrderStatus(draft.orderId);
      if (orderStatus.payment_status === "paid") {
        setPayment({ orderId: draft.orderId, status: "paid" });
        track({ event: "payment_succeeded", orderId: draft.orderId, amount: price.total });
        router.push("/confirmed");
      } else {
        setStatus("failed");
        setError("Payment verification timed out. If money was debited, you'll receive a confirmation shortly.");
        track({ event: "payment_failed", orderId: draft.orderId, amount: price.total });
      }
    } catch (err) {
      setStatus("failed");
      setError(
        err instanceof Error ? err.message : "Payment was cancelled or failed.",
      );
      track({ event: "payment_failed", orderId: draft.orderId, amount: price.total });
    }
  };

  const retry = () => {
    setStatus("idle");
    setError(null);
    idempotencyRef.current = null;
    router.replace("/pay");
  };

  const isBusy = status === "validating" || status === "processing" || status === "verifying" || recovering;

  const statusLabel = (() => {
    switch (status) {
      case "validating": return "Validating order…";
      case "processing": return "Initiating payment…";
      case "verifying": return "Verifying payment…";
      default: return strings.pay.processing;
    }
  })();

  return (
    <>
      <TapeProgress currentRoute="/review" />
      <ScreenShell className="pt-4">
        <p className="eyebrow">Payment</p>
        <h1 className="font-heading text-h1 text-ink-navy">
          {strings.pay.title}
        </h1>

        {/* Order summary card */}
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

        {error && (
          <div className="mt-4">
            <Banner variant="error" title={strings.pay.failureTitle}>
              <p>{error}</p>
            </Banner>
          </div>
        )}

        <div className="mt-6">
          <Button
            onClick={pay}
            disabled={isBusy}
            loading={isBusy}
            fullWidth
          >
            {isBusy ? statusLabel : strings.pay.payCta(price.total)}
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

// ─── Cashfree SDK loader ─────────────────────────────────────────────────────

interface CashfreeSDK {
  checkout: (options: {
    paymentSessionId: string;
    redirectTarget: "_modal" | "_self" | "_blank";
  }) => Promise<unknown>;
}

async function loadCashfreeSDK(): Promise<CashfreeSDK> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cashfree SDK can only be loaded in the browser"));
      return;
    }

    const w = window as unknown as Record<string, { (): CashfreeSDK } | undefined>;

    if (w.Cashfree) {
      resolve(w.Cashfree());
      return;
    }

    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => {
      if (w.Cashfree) {
        resolve(w.Cashfree());
      } else {
        reject(new Error("Cashfree SDK failed to initialize"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load payment SDK"));
    document.head.appendChild(script);
  });
}

// ─── Order status poller ─────────────────────────────────────────────────────

async function pollOrderStatus(
  orderId: string,
  maxAttempts = 5,
  intervalMs = 2000,
): Promise<OrderStatusOut> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const status = await checkoutApi.getOrderStatus(orderId);
      if (status.payment_status === "paid") return status;
    } catch {
      // Ignore transient errors during polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return checkoutApi.getOrderStatus(orderId);
}
