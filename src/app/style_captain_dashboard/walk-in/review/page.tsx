"use client";

/**
 * /style_captain_dashboard/walk-in/review?order=<id> — order review + QR +
 * payment, all from the server snapshot (refresh-proof). Check now is
 * inline; once paid the same screen offers Start measurement | Schedule a
 * slot (a booked slot replaces both). Cancelling shows the dropped card;
 * a started measurement shows the done card.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { SlotSheet } from "@/components/order/SlotSheet";
import { WalkInQrCard } from "@/components/style-captain/WalkInQrCard";
import { ArrowLeft, Calendar, Clock, Ruler } from "@/components/ui/icons";
import { Button } from "@/components/ui/Button";
import { walkInPayUrl } from "@/lib/walkin-qr";
import { walkInReviewPhase } from "@/lib/walkin-review";
import { useWalkInDraft } from "@/lib/walkin-draft-store";
import {
  scWalkInBookSlot,
  scWalkInCancelOrder,
  scWalkInListSlots,
  scWalkInOrderSnapshot,
  scWalkInMeasureNow,
  scWalkInOrderStatus,
  type SCWalkInOrderSnapshot,
} from "@/lib/style-captain-api";

const bannerCls =
  "rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text";

function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReviewScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draft = useWalkInDraft();
  const orderId = searchParams.get("order");

  const [snapshot, setSnapshot] = useState<SCWalkInOrderSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [slotSheetOpen, setSlotSheetOpen] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async (id: string) => {
    try {
      const snap = await scWalkInOrderSnapshot(id);
      setSnapshot(snap);
      return snap;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load this walk-in.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!orderId) {
      router.replace("/style_captain_dashboard");
      return;
    }
    void refreshSnapshot(orderId).then((snap) => {
      if (!snap) return;
      if (snap.stage === "cancelled") setCancelled(true);
    });
  }, [orderId, refreshSnapshot, router]);

  // Slot-first phase: no slot → choose; slot exists → payment check gates
  // confirmation (later visit) or opening the job (measured now).
  const phase = walkInReviewPhase({
    job: snapshot?.job ?? null,
    paymentReady: snapshot?.payment_ready ?? false,
  });

  // Paid + measured-now → straight into the measurement wizard. The job is
  // already assigned to THIS captain (payment books it to the one who
  // drafted/checked). The done card below is the fallback while the job id
  // is missing or the redirect is in flight.
  const jobId = snapshot?.job_id ?? null;
  useEffect(() => {
    if (phase === "done" && jobId) {
      router.replace(`/style_captain_dashboard/measure/${jobId}`);
    }
  }, [phase, jobId, router]);

  const lastCheckedLabel = useMemo(() => {
    if (!lastCheckedAt) return null;
    return new Date(lastCheckedAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [lastCheckedAt]);

  const payUrl =
    orderId && snapshot
      ? walkInPayUrl(window.location.origin, orderId, snapshot.user.phone ?? draft.phone)
      : null;

  async function handleCheckPayment() {
    if (!orderId || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await scWalkInOrderStatus(orderId);
      setLastCheckedAt(Date.now());
      if (res.fulfillment_status === "cancelled") {
        setCancelled(true);
        return;
      }
      if (res.ready_for_measurement) {
        // Paid/COD → refresh; the phase derives to confirmation (later
        // visit) or done (measured now → open the job).
        await refreshSnapshot(orderId);
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : "Could not check payment status");
    } finally {
      setChecking(false);
    }
  }

  /** Measure Now — DRAFT an immediate slot (right now). Nothing is booked;
   *  Check for Payment books it and opens the job once paid. */
  async function handleMeasureNow() {
    if (!orderId || measuring) return;
    setMeasuring(true);
    setPageError(null);
    try {
      await scWalkInMeasureNow(orderId);
      await refreshSnapshot(orderId);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not draft the measurement slot");
    } finally {
      setMeasuring(false);
    }
  }

  async function handleDrop() {
    if (!orderId) return;
    if (!window.confirm("Drop this walk-in? The draft order will be cancelled.")) return;
    setPageError(null);
    try {
      await scWalkInCancelOrder(orderId);
      draft.reset();
      setCancelled(true);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Could not drop the walk-in");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!orderId) return null;

  if (loadError && !snapshot) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
        <div className={bannerCls}>{loadError}</div>
        <Link
          href="/style_captain_dashboard"
          className="block text-center text-caption text-accent-text underline"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (cancelled) {
    return (
      <div className="mx-auto min-h-screen max-w-lg space-y-5 px-4 pt-6">
        <div className="rounded-card border border-hairline-strong bg-chalk-white px-4 py-4 text-caption text-muted">
          This walk-in was dropped. The draft order stays cancelled.
        </div>
        <Button fullWidth onClick={() => draft.reset()}>
          Start a new walk-in
        </Button>
        <Link href="/style_captain_dashboard">
          <Button fullWidth variant="secondary">
            Back to dashboard
          </Button>
        </Link>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto min-h-screen max-w-lg space-y-5 px-4 pt-6">
        <div className="rounded-card border border-green-200 bg-green-50 px-4 py-4 text-caption text-green-800">
          <span className="font-semibold">✓ Measurement started.</span> Order{" "}
          {snapshot?.order_number} moved to the measurement wizard.
        </div>
        <Link href="/style_captain_dashboard">
          <Button fullWidth>Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  if (phase === "confirmation") {
    return (
      <div className="mx-auto min-h-screen max-w-lg space-y-5 px-4 pt-6">
        <div className="flex items-start gap-3 rounded-card border border-green-200 bg-green-50 p-4">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-chalk-white"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            <Calendar size={18} />
          </span>
          <div className="min-w-0">
            <div className="text-body font-semibold text-green-900">
              ✓ Order {snapshot?.order_number} confirmed
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-body text-ink">
              <Clock size={14} className="text-accent-text" />
              {snapshot?.job?.scheduled_at ? slotLabel(snapshot.job.scheduled_at) : "Visit scheduled"}
            </div>
            <div className="mt-1 text-caption text-green-900/80">
              Payment confirmed · a style captain will visit at the booked time.
            </div>
          </div>
        </div>
        <Link href="/style_captain_dashboard">
          <Button fullWidth>Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
        Loading walk-in…
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-28 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() =>
            router.push(
              `/style_captain_dashboard/walk-in/garments?order=${encodeURIComponent(orderId)}`,
            )
          }
          aria-label="Go back"
          className="rounded-full border border-hairline-strong bg-chalk-white p-2 text-ink transition hover:bg-mist-navy/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <div className="text-eyebrow text-accent-text">Walk-in</div>
          <h1 className="font-heading text-head-3 text-ink">Review &amp; payment</h1>
        </div>
      </div>

      {(pageError || checkError) && (
        <div className={`mb-4 ${bannerCls}`}>{pageError ?? checkError}</div>
      )}

      <div className="space-y-5">
        <div className="rounded-card border border-hairline bg-chalk-white p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-body font-semibold text-ink">
              Order {snapshot.order_number}
            </div>
            {snapshot.total_price != null && (
              <div className="text-body font-semibold text-ink">
                ₹{snapshot.total_price.toLocaleString("en-IN")}
              </div>
            )}
          </div>
          <div className="mt-0.5 text-caption text-muted">
            {snapshot.user.name ?? "Customer"} · {snapshot.user.phone}
          </div>
          <button
            onClick={() =>
              router.push(
                `/style_captain_dashboard/walk-in/address?order=${encodeURIComponent(orderId)}`,
              )
            }
            className="mt-1 block text-caption font-medium text-ink-navy underline"
          >
            Edit address
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-caption font-medium text-muted">Garments</div>
          {snapshot.garments.map((g) => (
            <div
              key={g.garment_order_id}
              className="flex items-center justify-between rounded-card border border-hairline-strong bg-chalk-white px-4 py-3"
            >
              <div className="text-body text-ink">{g.label}</div>
              <button
                onClick={() =>
                  router.push(
                    `/style_captain_dashboard/walk-in/garments?order=${encodeURIComponent(
                      orderId,
                    )}&edit=${encodeURIComponent(g.garment_order_id)}`,
                  )
                }
                className="text-caption font-medium text-ink-navy underline"
              >
                Edit
              </button>
            </div>
          ))}
          {snapshot.garments.length === 0 && (
            <div className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-3 text-caption text-muted">
              No garments yet — add one to continue.
            </div>
          )}
        </div>

        <Button
          fullWidth
          variant="secondary"
          onClick={() =>
            router.push(
              `/style_captain_dashboard/walk-in/garments?order=${encodeURIComponent(orderId)}`,
            )
          }
        >
          + Add another garment
        </Button>

        {payUrl && (
          <WalkInQrCard
            url={payUrl}
            caption="Ask the customer to scan — the order opens in the Draep app for payment."
          />
        )}

        {/* ── Measurement slot ──────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="text-caption font-medium text-muted">Measurement slot</div>
          {snapshot.job ? (
            <div className="flex items-start gap-3 rounded-card border border-hairline-strong bg-chalk-white px-4 py-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mist-navy text-ink-navy"
              >
                {snapshot.job.status === "in_progress" ? <Ruler size={16} /> : <Calendar size={16} />}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-body font-medium text-ink">
                  <Clock size={14} className="text-accent-text" />
                  {snapshot.job.scheduled_at ? slotLabel(snapshot.job.scheduled_at) : "Visit scheduled"}
                </div>
                <div className="text-caption text-muted">
                  {snapshot.job.status === "in_progress"
                    ? "Being measured now."
                    : "Drafted visit — holds the time without blocking anyone. Payment books it."}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-card border border-dashed border-hairline-strong bg-mist-navy/10 px-4 py-3 text-caption text-muted">
              No slot chosen yet — measure now or schedule a visit below.
            </div>
          )}
        </div>

        {/* ── Payment status ─────────────────────────────────────────────── */}
        <div className="space-y-3 rounded-card border border-hairline bg-mist-navy/20 p-4">
          <div className="text-eyebrow uppercase tracking-wider text-accent-text">
            Payment
          </div>
          {snapshot.payment_ready ? (
            <div className="rounded-card border border-green-200 bg-green-50 px-3 py-2.5 text-caption font-medium text-green-800">
              ✓ Payment confirmed
              {snapshot.cod_selected ? " (Cash on delivery)" : ""}
            </div>
          ) : (
            <>
              <p className="text-caption text-muted">
                The customer pays (or chooses Cash on delivery) in the app after
                scanning. Then check here.
              </p>
              {lastCheckedLabel && (
                <div className="text-center text-[11px] text-muted">
                  Last checked {lastCheckedLabel} — not paid yet.
                </div>
              )}
              <button
                onClick={() => void handleDrop()}
                className="w-full text-center text-caption text-error-text underline"
              >
                Drop this walk-in
              </button>
            </>
          )}
        </div>

        {/* ── Sticky conditional CTA ───────────────────────────────────────
            No slot → Measure Now | Schedule Later; slot exists but unpaid →
            Check for Payment. Confirmation/done phases render their own
            full views (no bar). */}
        {(phase === "choose-slot" || phase === "check-payment") && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-chalk-white/95 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {phase === "choose-slot" ? (
                <>
                  <button
                    onClick={() => void handleMeasureNow()}
                    disabled={measuring}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-pill text-caption font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
                    style={{ backgroundImage: "var(--tape-gradient)" }}
                  >
                    {measuring && (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                    )}
                    Measure Now
                  </button>
                  <button
                    onClick={() => setSlotSheetOpen(true)}
                    className="flex h-12 flex-1 items-center justify-center rounded-pill border-[1.5px] border-ink-navy text-caption font-semibold text-ink-navy transition-all ease-brand active:scale-[0.98]"
                  >
                    Schedule Later
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void handleCheckPayment()}
                  disabled={checking}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-pill text-caption font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundImage: "var(--tape-gradient)" }}
                >
                  {checking && (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
                  )}
                  Check for Payment
                </button>
              )}
            </div>
          </div>
        )}

        {/* Captain-side slot picker — same UX as the customer dashboard,
            backed by the captain's own walk-in slot endpoints. */}
        <SlotSheet
          open={slotSheetOpen}
          onClose={() => setSlotSheetOpen(false)}
          orderId={orderId}
          currentBooking={null}
          onBooked={() => {
            setSlotSheetOpen(false);
            void refreshSnapshot(orderId);
          }}
          getSlotsFn={(id, from, to) => scWalkInListSlots(id, from, to)}
          bookFn={async (id, startAt) => {
            const r = await scWalkInBookSlot(id, startAt);
            return {
              job_id: r.id,
              captain_id: null,
              captain_name: r.captain_name,
              scheduled_at: r.scheduled_at ?? startAt,
              status: "scheduled" as const,
            };
          }}
          suppressNotify
        />
      </div>
    </div>
  );
}

export default function WalkInReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-center text-caption text-muted">
          Loading…
        </div>
      }
    >
      <ReviewScreen />
    </Suspense>
  );
}
