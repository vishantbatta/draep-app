"use client";

/**
 * Public documents page — the shareable order invoice view.
 *
 * URL shape: /invoice/{order_id}. The order id (a random UUID) doubles as the
 * unguessable share token — no auth, same access model as before.
 *
 * Two zones, one honesty rule:
 *  - TOP: live order summary (GET /public/invoice/{order_id}) — reflects the
 *    order as it is NOW (items can grow after payment).
 *  - BELOW: the FROZEN tax documents (GET /public/documents/{order_id}) —
 *    minted the moment money moved, immutable from then on. If the order
 *    changed after a document was issued, the numbers below stay exactly
 *    what they were; a second invoice covers the difference.
 *
 * When dates differ (payment received earlier than the document — legacy
 * backfill), the plain-language note spells that out instead of hiding it.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import type { InvoiceInput } from "@/lib/invoice-pdf";
import {
  generateGstDocumentPdf,
  paiseToRupeeString,
  type GstCreditNote,
  type GstDocument,
  type GstInvoice,
  type GstSeller,
  type OrderDocuments,
} from "@/lib/gst-documents";

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}

export default function PublicInvoicePage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [live, setLive] = useState<InvoiceInput | null>(null);
  const [docs, setDocs] = useState<OrderDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Both calls share the order UUID as the token; the documents call
        // is the one that can 404 meaningfully (order missing).
        const [liveRes, docsRes] = await Promise.all([
          fetch(`/api/v1/public/invoice/${orderId}`),
          fetch(`/api/v1/public/documents/${orderId}`),
        ]);
        if (!docsRes.ok) {
          throw new Error(
            docsRes.status === 404
              ? "Invoice not found — check the link you were sent."
              : `Could not load documents (${docsRes.status}).`,
          );
        }
        const docsJson = (await docsRes.json()) as OrderDocuments;
        const liveJson = liveRes.ok ? ((await liveRes.json()) as InvoiceInput) : null;
        if (cancelled) return;
        setDocs(docsJson);
        setLive(liveJson);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load invoice.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function handleDownload(doc: GstDocument, seller?: GstSeller) {
    setDownloading(doc.number);
    try {
      await generateGstDocumentPdf(doc, seller);
    } catch {
      // Keep it friendly — the row stays downloadable.
    } finally {
      setDownloading(null);
    }
  }

  const invoices: GstInvoice[] = docs?.invoices ?? [];
  const creditNotes: GstCreditNote[] = docs?.creditNotes ?? [];
  const seller: GstSeller | undefined = invoices[0]?.seller;
  const docCount = invoices.length + creditNotes.length;

  const liveTotal = (live?.garmentLines ?? []).reduce((s, l) => s + (l.total ?? 0), 0) +
    (live?.adjustmentLines ?? []).reduce((s, l) => s + (l.total ?? 0), 0);
  const livePaid = (live?.payments ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);

  return (
    <main className="flex min-h-screen flex-col items-center bg-mist-navy/30 px-3 py-6 print:bg-white">
      <div className="flex w-full max-w-[794px] items-center justify-between gap-3 pb-4">
        <div>
          <div className="font-heading text-lg font-semibold text-ink-navy">Draep</div>
          <div className="text-xs text-ink/60">
            {docCount > 0
              ? `Tax documents · Order #${docs?.orderNumber ?? ""}`
              : "Tax documents"}
          </div>
        </div>
      </div>

      {error && (
        <div className="w-full max-w-[794px] rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && !docs && (
        <div className="flex h-64 w-full max-w-[794px] items-center justify-center rounded-xl border border-hairline bg-white text-sm text-ink/50">
          Loading documents…
        </div>
      )}

      {docs && (
        <div className="w-full max-w-[794px] space-y-5">
          {/* ── Live order summary (reflects the order as it is now) ── */}
          {live && (
            <section className="rounded-xl border border-hairline bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-heading text-base font-semibold text-ink-navy">
                  Order summary
                </h2>
                <span className="text-[10px] uppercase tracking-wide text-ink/40">
                  live · updates with the order
                </span>
              </div>
              <div className="space-y-1.5 text-sm">
                {(live.garmentLines ?? []).map((l, i) => (
                  <div key={i} className="flex justify-between text-ink/80">
                    <span>{l.label}</span>
                    <span className="font-mono text-[13px]">{formatPrice(l.total)}</span>
                  </div>
                ))}
                {(live.adjustmentLines ?? []).map((l, i) => (
                  <div key={i} className="flex justify-between text-ink/60">
                    <span>{l.label}</span>
                    <span className="font-mono text-[13px]">{formatPrice(l.total)}</span>
                  </div>
                ))}
                <div className="mt-2 flex justify-between border-t border-hairline pt-2 font-semibold text-ink-navy">
                  <span>Order total (today)</span>
                  <span className="font-mono">{formatPrice(liveTotal)}</span>
                </div>
                {livePaid > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Paid to date</span>
                    <span className="font-mono text-[13px]">{formatPrice(livePaid)}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── Frozen tax documents (immutable since issue) ── */}
          <section className="rounded-xl border border-hairline bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold text-ink-navy">
                Tax documents
              </h2>
              <span className="text-[10px] uppercase tracking-wide text-ink/40">
                issued automatically · unchangeable
              </span>
            </div>

            {docCount === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline px-4 py-5 text-center text-sm text-ink/50">
                No tax documents yet — an invoice appears here the moment a payment is made.
              </p>
            ) : (
              <div className="space-y-2.5">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-pill bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                          Tax Invoice
                        </span>
                        <span className="font-mono text-[13px] font-semibold text-ink">
                          {inv.number}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-ink/60">
                        Issued {inv.dateIst ?? "—"}
                        {inv.amounts.reversedPaise > 0 &&
                          ` · reversed ${paiseToRupeeString(inv.amounts.reversedPaise)} (net ${paiseToRupeeString(inv.amounts.netPaise)})`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-ink">
                        {paiseToRupeeString(inv.amounts.totalPaise)}
                      </span>
                      <button
                        onClick={() => handleDownload(inv)}
                        disabled={downloading === inv.number}
                        className="rounded-lg bg-ink-navy px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {downloading === inv.number ? "Preparing…" : "⬇ PDF"}
                      </button>
                    </div>
                  </div>
                ))}
                {creditNotes.map((cn) => (
                  <div
                    key={cn.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-white px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-pill bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                          Credit Note
                        </span>
                        <span className="font-mono text-[13px] font-semibold text-ink">
                          {cn.number}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-ink/60">
                        Issued {cn.dateIst ?? "—"} · against {cn.invoiceNumber ?? "—"}
                        {cn.reason ? ` · ${cn.reason}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-purple-700">
                        − {paiseToRupeeString(cn.amountPaise)}
                      </span>
                      <button
                        onClick={() => handleDownload(cn, seller)}
                        disabled={downloading === cn.number}
                        className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {downloading === cn.number ? "Preparing…" : "⬇ PDF"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-ink/50">
              Every payment you make gets its own invoice the moment it is captured; refunds appear
              as credit notes. Documents never change after issue — if an order grows after payment,
              a fresh invoice covers the difference.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
