"use client";

/**
 * ReversePaymentModal — undo a payment that was RECORDED IN ERROR.
 *
 * This is not a refund: no money moves. The payment stays in history (the
 * invoice it generated remains valid — it documented money that genuinely
 * arrived) but is offset out of the order's ledger by a credit note. Use
 * "Refund" when actual money needs to go back to the customer; use this
 * when the row itself was a mistake (wrong amount, wrong order, duplicate).
 */

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { reversePayment } from "@/lib/admin-api";

interface ReversePaymentModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  transaction: {
    id: string;
    amount: number | null;
    provider: string | null;
    captured_at: string | null;
  } | null;
  /** Called after a successful reversal so the parent refreshes. */
  onSuccess: () => void;
}

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

export function ReversePaymentModal({
  open,
  onClose,
  orderId,
  transaction,
  onSuccess,
}: ReversePaymentModalProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  const fullAmount = transaction?.amount ?? 0;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccessNote(null);
    setAmount(String(fullAmount));
    setNote("");
  }, [open, fullAmount]);

  const amountNum = Number(amount);
  const canSubmit =
    !busy && amount !== "" && !Number.isNaN(amountNum) && amountNum > 0 && amountNum <= fullAmount;

  async function handleSubmit() {
    if (!transaction) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reversePayment(orderId, transaction.id, {
        amount_rupees: Math.round(amountNum),
        note: note.trim() || undefined,
      });
      setSuccessNote(
        `Reversed ${formatPrice(result.reversed_amount)}. Credit note issued — payment status is now "${result.payment_status ?? "updated"}".`,
      );
      // Give the admin a beat to read the confirmation, then refresh + close.
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1600);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reverse payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Reverse payment (recorded in error)"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-ink transition hover:bg-mist-navy/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Reversing…" : "Reverse payment"}
          </button>
        </div>
      }
    >
      {successNote ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-3 text-xs text-green-800">
          {successNote}
        </div>
      ) : (
        <>
          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Consequence, in plain words (F4.2). */}
          <div className="mb-4 rounded-md border border-hairline bg-mist-navy/30 px-3 py-3 text-xs leading-relaxed text-ink">
            Removes <b>{formatPrice(fullAmount)}</b> from this order&apos;s ledger and issues a{" "}
            <b>credit note</b> for the reversed amount. The original invoice stays — it documented
            money that genuinely arrived — and the credit note offsets it.{" "}
            <b>No money moves.</b>
          </div>

          {/* Online-payment variant warning (F4.3). */}
          {transaction?.provider === "cashfree" && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
              ⚠ This money was collected online via Cashfree. Reversing here only fixes your books —{" "}
              <b>also refund it on the gateway</b> (Cashfree dashboard → Refunds) so the customer
              actually gets their money back.
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                Amount to reverse (₹)
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted">₹</span>
                <input
                  type="number"
                  min="1"
                  max={fullAmount}
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                />
              </div>
              {amountNum > fullAmount && (
                <p className="mt-1 text-[11px] text-red-600">
                  Exceeds the payment amount of {formatPrice(fullAmount)}.
                </p>
              )}
              {fullAmount > 0 && (
                <button
                  onClick={() => setAmount(String(fullAmount))}
                  disabled={busy}
                  className="mt-1 text-[11px] text-tape hover:underline disabled:opacity-50"
                >
                  Reverse full amount ({formatPrice(fullAmount)})
                </button>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                Note (optional — printed on the credit note)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                placeholder="e.g. recorded twice by mistake"
                className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
              />
            </div>
            <p className="text-[11px] text-muted">
              Wrong choice? <b>Refund</b> (in the payment modal) sends money back to the customer.
              This button is only for rows that should never have been recorded.
            </p>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
