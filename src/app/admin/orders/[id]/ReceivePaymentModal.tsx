"use client";

/**
 * ReceivePaymentModal — collect money or issue a refund against an order.
 *
 * Two tabs:
 *  - "Receive payment": either create a Cashfree payment link for the customer
 *    to pay online (default), or record an offline (already-collected) payment.
 *  - "Refund": record a full or partial refund.
 *
 * Amounts are **rupees** everywhere (per PRICING.md) — the backend stores the
 * same integer value; formatPrice() treats its input as rupees. No /100.
 */

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  receivePayment,
  recordRefund,
  getOrderBalance,
  type OrderBalance,
  type ReceivePaymentResult,
} from "@/lib/admin-api";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

const OFFLINE_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cod", label: "Cash on delivery" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
] as const;

// ─── Props ─────────────────────────────────────────────────────────────────

interface ReceivePaymentModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  /** Called after a successful payment/refund so the parent can refresh. */
  onSuccess: () => void;
  /** Initial tab: "receive" or "refund". */
  initialTab?: "receive" | "refund";
  /** Order grand total (rupees) — used to prefill the amount. */
  totalPrice: number | null | undefined;
  /** Customer's phone (prefilled in the cashfree phone field). */
  customerPhone: string | null | undefined;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ReceivePaymentModal({
  open,
  onClose,
  orderId,
  onSuccess,
  initialTab = "receive",
  totalPrice,
  customerPhone,
}: ReceivePaymentModalProps) {
  const [tab, setTab] = useState<"receive" | "refund">(initialTab);
  const [balance, setBalance] = useState<OrderBalance | null>(null);

  // Receive-payment form state
  // Default mode is "cashfree" (send payment link) — it's the primary action.
  const [mode, setMode] = useState<"cashfree" | "offline">("cashfree");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("cash");
  const [methodRef, setMethodRef] = useState("");
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [cfResult, setCfResult] = useState<ReceivePaymentResult | null>(null);

  // Refund form state
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load balance whenever the modal opens or tab changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCfResult(null);
    // Prefill phone from the customer record.
    setPhone(customerPhone ?? "");
    getOrderBalance(orderId)
      .then((b) => {
        setBalance(b);
        // Prefill the receive amount from the order grand total (the full
        // amount the customer owes), not just the balance due.
        if (tab === "receive") {
          const prefill = totalPrice ?? b.total_price ?? b.balance_due;
          setAmount(prefill && prefill > 0 ? String(prefill) : "");
        } else {
          const refundable = (b.captured ?? 0) - (b.refunded ?? 0);
          setRefundAmount(refundable > 0 ? String(refundable) : "");
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load balance"));
  }, [open, orderId, tab, totalPrice, customerPhone]);

  // Reset internal state when the modal closes.
  useEffect(() => {
    if (open) return;
    setMode("cashfree");
    setAmount("");
    setMethodRef("");
    setNote("");
    setPhone("");
    setRefundAmount("");
    setRefundReason("");
    setCfResult(null);
    setError(null);
  }, [open]);

  // Switch tab when initialTab changes.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const balanceDue = balance?.balance_due ?? 0;
  const refundable = (balance?.captured ?? 0) - (balance?.refunded ?? 0);

  const amountNum = Number(amount);
  const canSubmitReceive =
    !busy &&
    amount !== "" &&
    !Number.isNaN(amountNum) &&
    amountNum > 0;

  const refundAmountNum = Number(refundAmount);
  const canSubmitRefund =
    !busy &&
    refundAmount !== "" &&
    !Number.isNaN(refundAmountNum) &&
    refundAmountNum > 0 &&
    refundAmountNum <= refundable;

  // ── Handlers ─────────────────────────────────────────────────────────

  async function handleReceive() {
    setBusy(true);
    setError(null);
    setCfResult(null);
    try {
      const result = await receivePayment(orderId, {
        amount_rupees: Math.round(amountNum),
        mode,
        method: mode === "offline" ? method : undefined,
        method_detail: mode === "offline" && methodRef.trim()
          ? { reference: methodRef.trim() }
          : undefined,
        note: note.trim() || undefined,
        customer_phone: mode === "cashfree" && phone.trim() ? phone.trim() : undefined,
      });
      if (mode === "cashfree") {
        // For Cashfree, show the link/session for the admin to share.
        setCfResult(result);
      } else {
        // Offline — done, refresh + close.
        onSuccess();
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    setBusy(true);
    setError(null);
    try {
      await recordRefund(orderId, {
        amount_rupees: Math.round(refundAmountNum),
        reason: refundReason.trim() || undefined,
        provider: "manual",
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record refund");
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Payment"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted">
            {tab === "receive" ? (
              <>Order total: <span className="font-mono font-medium text-ink">{formatPrice(totalPrice)}</span></>
            ) : (
              <>Refundable: <span className="font-mono font-medium text-ink">{formatPrice(refundable)}</span></>
            )}
          </div>
          {tab === "receive" ? (
            <button
              onClick={handleReceive}
              disabled={!canSubmitReceive}
              className="rounded-md bg-ink-navy px-4 py-2 text-sm font-medium text-chalk-white hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Processing…" : mode === "cashfree" ? "Create payment link" : "Record payment"}
            </button>
          ) : (
            <button
              onClick={handleRefund}
              disabled={!canSubmitRefund}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Processing…" : "Record refund"}
            </button>
          )}
        </div>
      }
    >
      {/* Tab switcher */}
      <div className="mb-4 flex gap-1 rounded-lg bg-mist-navy/40 p-1">
        <button
          onClick={() => setTab("receive")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === "receive"
              ? "bg-chalk-white text-ink-navy shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          Receive payment
        </button>
        <button
          onClick={() => setTab("refund")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === "refund"
              ? "bg-chalk-white text-ink-navy shadow-sm"
              : "text-muted hover:text-ink"
          }`}
        >
          Refund
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* ── Receive tab ── */}
      {tab === "receive" && (
        <div className="space-y-4">
          {/* Cashfree link result (shown after creating a link) */}
          {cfResult && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-green-800">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Payment link created{cfResult.sms_sent ? " • SMS sent to customer" : ""}
              </div>
              <div className="space-y-2">
                {cfResult.link_url && (
                  <div>
                    <label className="text-[10px] font-medium uppercase tracking-wide text-muted">
                      Payment link
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-ink">
                        {cfResult.link_url}
                      </code>
                      <button
                        onClick={() => copyToClipboard(cfResult.link_url!)}
                        className="shrink-0 rounded border border-hairline px-2 py-1 text-[11px] text-ink hover:bg-mist-navy"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
                {cfResult.link_url && (
                  <a
                    href={cfResult.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-md bg-ink-navy px-3 py-1.5 text-xs font-medium text-chalk-white hover:bg-ink-navy/90"
                  >
                    Open payment page →
                  </a>
                )}
                <p className="text-[11px] text-muted">
                  {cfResult.sms_sent
                    ? "An SMS with the payment link has been sent to the customer's phone. The payment will be captured automatically via webhook once paid."
                    : "Share this link with the customer. The payment will be captured automatically via webhook once paid."}
                </p>
              </div>
            </div>
          )}

          {/* Mode toggle — Send payment link first (default) */}
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
              Mode
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("cashfree")}
                disabled={busy}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                  mode === "cashfree"
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline bg-white text-ink hover:bg-mist-navy/40"
                }`}
              >
                Send payment link
              </button>
              <button
                onClick={() => setMode("offline")}
                disabled={busy}
                className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                  mode === "offline"
                    ? "border-ink-navy bg-ink-navy text-chalk-white"
                    : "border-hairline bg-white text-ink hover:bg-mist-navy/40"
                }`}
              >
                Record offline
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              {mode === "cashfree"
                ? "Generate a Cashfree payment link for the customer to pay online."
                : "Log money you've already collected (cash, UPI, bank transfer, COD)."}
            </p>
          </div>

          {/* Amount — prefilled from order grand total */}
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
              Amount (₹)
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">₹</span>
              <input
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                placeholder="Amount in rupees"
                className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
              />
            </div>
            {totalPrice && totalPrice > 0 && (
              <button
                onClick={() => setAmount(String(totalPrice))}
                disabled={busy}
                className="mt-1 text-[11px] text-tape hover:underline disabled:opacity-50"
              >
                Use order total ({formatPrice(totalPrice)})
              </button>
            )}
          </div>

          {/* Cashfree-only: editable phone number (prefilled from customer) */}
          {mode === "cashfree" && (
            <div>
              <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                Customer phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
                placeholder="10-digit mobile number"
                className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] text-muted">
                Prefilled from the customer record. Edit if the payment should
                go to a different number.
              </p>
            </div>
          )}

          {/* Offline-only fields */}
          {mode === "offline" && (
            <>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Method
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                >
                  {OFFLINE_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Reference (optional)
                </label>
                <input
                  type="text"
                  value={methodRef}
                  onChange={(e) => setMethodRef(e.target.value)}
                  disabled={busy}
                  placeholder="UPI ref / bank txn id / cheque no."
                  className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                  placeholder="Internal note"
                  className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Refund tab ── */}
      {tab === "refund" && (
        <div className="space-y-4">
          {refundable <= 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No refundable amount on this order (captured {formatPrice(balance?.captured ?? 0)}{" "}
              − already refunded {formatPrice(balance?.refunded ?? 0)}).
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Refund amount (₹)
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted">₹</span>
                  <input
                    type="number"
                    min="1"
                    max={refundable}
                    step="1"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    disabled={busy}
                    placeholder="Amount to refund"
                    className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                  />
                </div>
                {refundAmountNum > refundable && (
                  <p className="mt-1 text-[11px] text-red-600">
                    Exceeds refundable amount of {formatPrice(refundable)}.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  disabled={busy}
                  placeholder="Why is this refund being issued?"
                  className="w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink disabled:opacity-60"
                />
              </div>
              <p className="text-[11px] text-muted">
                This records a manual refund in the ledger and recomputes the
                order&apos;s payment status. For gateway-issued refunds via Cashfree,
                use the Cashfree dashboard.
              </p>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
