"use client";

/**
 * DocumentsSection — the order's minted GST documents (tax invoices +
 * credit notes), replacing the old invoice-date bottom sheet.
 *
 * One mental model: money in → invoice, money out → credit note. Documents
 * appear here automatically the moment a payment captures or a refund
 * confirms — nothing to pick, no dates, no numbers. Rows chain both ways
 * (an invoice links to the credit notes that reversed it and back), every
 * row has exactly one primary action (Download), and if the books are
 * missing a document for this order a banner shows up with a one-click
 * repair (backfill, which issues the missing document dated TODAY — the
 * law forbids backdating).
 */

import { useCallback, useEffect, useState } from "react";
import {
  backfillLegacyDocuments,
  fetchOrderDocuments,
  fetchReconciliation,
  type ReconciliationProblem,
} from "@/lib/admin-api";
import {
  generateGstDocumentPdf,
  paiseToRupeeString,
  type GstCreditNote,
  type GstDocument,
  type GstInvoice,
  type GstSeller,
  type OrderDocuments,
} from "@/lib/gst-documents";

interface DocumentsSectionProps {
  orderId: string;
  /** Bump to reload (payments/refunds mint new documents). */
  refreshKey?: number;
}

type Row =
  | {
      key: string;
      kind: "invoice";
      number: string;
      dateIst: string | null;
      amountPaise: number;
      /** credit note numbers reversing this invoice */
      reversedBy: string[];
      voided: boolean;
      voidReason: string | null;
      paymentRef: string | null;
      doc: GstInvoice;
    }
  | {
      key: string;
      kind: "credit_note";
      number: string;
      dateIst: string | null;
      amountPaise: number;
      /** invoice this note reverses */
      against: string | null;
      reason: string | null;
      paymentRef: string | null;
      doc: GstCreditNote;
    };

export function DocumentsSection({ orderId, refreshKey = 0 }: DocumentsSectionProps) {
  const [docs, setDocs] = useState<OrderDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [problems, setProblems] = useState<ReconciliationProblem[]>([]);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, recon] = await Promise.all([
        fetchOrderDocuments(orderId),
        fetchReconciliation().catch(() => null),
      ]);
      setDocs(d);
      // Only this order's problems surface here (unminted capture / unnoted
      // refund). Series-gap / counter problems belong to the books, not a
      // single order page — the report view covers those.
      setProblems(
        (recon?.problems ?? []).filter(
          (p) =>
            p.orderId === orderId &&
            (p.code === "captured_without_invoice" || p.code === "refunded_without_credit_note"),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Auto-clear the toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleDownload(doc: GstDocument, seller?: GstSeller) {
    setDownloading(doc.number);
    try {
      await generateGstDocumentPdf(doc, seller);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  }

  /** One-click repair: mint whatever this order is missing (dated today). */
  async function handleRepair() {
    setRepairing(true);
    setRepairError(null);
    try {
      const result = await backfillLegacyDocuments([orderId], false);
      setToast(
        result.invoiceCount + result.creditNoteCount > 0
          ? `Minted ${result.invoiceCount} invoice(s) and ${result.creditNoteCount} credit note(s) dated today.`
          : "Nothing was missing — books already match the ledger.",
      );
      await load();
    } catch (e) {
      setRepairError(e instanceof Error ? e.message : "Repair failed");
    } finally {
      setRepairing(false);
    }
  }

  // ── Assemble chronological rows with chaining ──
  const invoices = docs?.invoices ?? [];
  const creditNotes = docs?.creditNotes ?? [];
  const seller: GstSeller | undefined = invoices[0]?.seller;

  const rows: Row[] = [
    ...invoices.map((inv): Row => ({
      key: inv.id,
      kind: "invoice",
      number: inv.number,
      dateIst: inv.dateIst,
      amountPaise: inv.amounts.totalPaise,
      reversedBy: creditNotes.filter((c) => c.invoiceNumber === inv.number).map((c) => c.number),
      voided: inv.voided,
      voidReason: inv.voidReason,
      paymentRef: inv.paymentRef,
      doc: inv,
    })),
    ...creditNotes.map((cn): Row => ({
      key: cn.id,
      kind: "credit_note",
      number: cn.number,
      dateIst: cn.dateIst,
      amountPaise: cn.amountPaise,
      against: cn.invoiceNumber,
      reason: cn.reason,
      paymentRef: null,
      doc: cn,
    })),
  ].sort((a, b) => (a.dateIst ?? "").localeCompare(b.dateIst ?? "") || a.number.localeCompare(b.number));

  const totalDocs = invoices.length + creditNotes.length;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-ink-navy">
          Invoices &amp; Credit Notes ({totalDocs})
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Mint-failure banner — books missing documents for THIS order. */}
      {problems.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="text-xs font-semibold text-amber-900">
            {problems.length} payment{problems.length > 1 ? "s" : ""} on this order lack{" "}
            {problems.some((p) => p.code === "captured_without_invoice") ? "an invoice" : "a credit note"}
          </div>
          <div className="mt-1 text-[11px] text-amber-800">
            Money moved without a document. &ldquo;Fix now&rdquo; issues the missing document — dated
            today, never backdated.
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={handleRepair}
              disabled={repairing}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {repairing ? "Fixing…" : "Fix now"}
            </button>
            {repairError && <span className="text-[11px] text-red-700">{repairError}</span>}
          </div>
        </div>
      )}

      {toast && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-xs text-green-800">
          {toast}
        </div>
      )}

      {loading && !docs ? (
        <div className="animate-pulse space-y-2 rounded-xl border border-hairline bg-chalk-white p-4">
          <div className="h-4 w-1/3 rounded bg-mist-navy/60" />
          <div className="h-8 w-full rounded bg-mist-navy/40" />
          <div className="h-8 w-full rounded bg-mist-navy/40" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={load}
            className="shrink-0 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : totalDocs === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-chalk-white px-4 py-6 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-mist-navy/60 text-sm">
            🧾
          </div>
          <p className="text-sm text-muted">
            No documents yet — invoices appear automatically when payments are recorded.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-medium">Number</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Linked</th>
                <th className="px-4 py-2 font-medium">Payment ref</th>
                <th className="px-4 py-2 text-right font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2 font-mono text-[12px] text-ink">{row.number}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                        row.kind === "invoice"
                          ? "bg-green-50 text-green-700"
                          : "bg-purple-50 text-purple-700"
                      }`}
                    >
                      {row.kind === "invoice" ? "Tax Invoice" : "Credit Note"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[12px] text-muted">{row.dateIst ?? "—"}</td>
                  <td
                    className={`px-4 py-2 text-right font-mono text-[13px] ${
                      row.kind === "invoice" ? "text-ink" : "text-purple-700"
                    }`}
                  >
                    {row.kind === "credit_note" ? "−" : ""}
                    {paiseToRupeeString(row.amountPaise)}
                  </td>
                  <td className="px-4 py-2">
                    {row.kind === "invoice" && row.voided ? (
                      <span className="inline-block rounded-pill bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                        Void
                      </span>
                    ) : row.kind === "invoice" && row.reversedBy.length > 0 ? (
                      <span className="inline-block rounded-pill bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        Reversed
                      </span>
                    ) : (
                      <span className="inline-block rounded-pill bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                        Issued
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[11px]">
                    {row.kind === "invoice" ? (
                      row.reversedBy.length > 0 ? (
                        <span className="font-mono text-purple-700" title="Credit notes reversing this invoice">
                          ← {row.reversedBy.join(", ")}
                        </span>
                      ) : row.voidReason ? (
                        <span className="text-muted" title={row.voidReason}>
                          {row.voidReason.length > 24 ? `${row.voidReason.slice(0, 24)}…` : row.voidReason}
                        </span>
                      ) : (
                        "—"
                      )
                    ) : row.against ? (
                      <span className="font-mono text-green-700" title="Invoice this note reverses">
                        → {row.against}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-[12px] text-muted">
                    {row.paymentRef ? (
                      <span className="font-mono">{row.paymentRef}</span>
                    ) : row.kind === "credit_note" && row.reason ? (
                      <span title={row.reason}>{row.reason.length > 20 ? `${row.reason.slice(0, 20)}…` : row.reason}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleDownload(row.doc, seller)}
                      disabled={downloading === row.number}
                      className="rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {downloading === row.number ? "…" : "⬇ PDF"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted">
        Money in → invoice · money out → credit note. Documents are issued automatically and are
        immutable — corrections are made with credit notes, never edits.
      </p>
    </section>
  );
}
