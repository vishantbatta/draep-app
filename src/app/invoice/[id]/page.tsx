"use client";

/**
 * Public invoice page — the shareable twin of the admin "Download Invoice PDF".
 *
 * URL shape: /invoice/{order_id}. The order id (a random UUID) doubles as the
 * unguessable share token: the backend's GET /api/v1/public/invoice/{order_id}
 * serves the assembled invoice data without auth, and this page renders the
 * EXACT same invoice fragment the PDF generator rasterizes
 * (buildInvoiceDocumentHtml) — inline, not in an iframe, so the page scrolls
 * as one document. Web-only extras that can't exist in a raster PDF: the
 * "Pay via UPI" anchor (a real link that opens the visitor's UPI app) and the
 * "Download PDF" button running the same generator in the visitor's browser.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  buildInvoiceDocumentHtml,
  generateInvoicePdf,
  invoiceUpiUrl,
  type InvoiceInput,
} from "@/lib/invoice-pdf";

export default function PublicInvoicePage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [invoice, setInvoice] = useState<InvoiceInput | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/invoice/${orderId}`);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Invoice not found — check the link you were sent."
              : `Could not load invoice (${res.status}).`,
          );
        }
        const input = (await res.json()) as InvoiceInput;
        if (cancelled) return;
        setInvoice(input);
        setHtml(await buildInvoiceDocumentHtml(input, { payUrl: invoiceUpiUrl(input) }));
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

  async function handleDownload() {
    if (!invoice) return;
    setDownloading(true);
    try {
      await generateInvoicePdf(invoice);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-mist-navy/30 px-3 py-6 print:bg-white">
      <div className="flex w-full max-w-[794px] items-center justify-between gap-3 pb-4">
        <div>
          <div className="font-heading text-lg font-semibold text-ink-navy">
            Draep
          </div>
          <div className="text-xs text-ink/60">
            {invoice ? `Tax Invoice · ${invoice.invoiceNumber}` : "Tax Invoice"}
          </div>
        </div>
        <button
          onClick={handleDownload}
          disabled={!invoice || downloading}
          className="rounded-lg bg-ink-navy px-4 py-2 text-xs font-semibold text-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? "Preparing PDF…" : "⬇ Download PDF"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && !html && (
        <div className="flex h-64 w-full max-w-[794px] items-center justify-center rounded-xl border border-hairline bg-white text-sm text-ink/50">
          Loading invoice…
        </div>
      )}

      {html && (
        <div
          className="w-full max-w-[794px] overflow-hidden rounded-xl border border-hairline bg-white shadow-sm"
          // Invoice markup is built in-app from escaped DB fields
          // (buildInvoiceDocumentHtml) — no third-party input.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </main>
  );
}
