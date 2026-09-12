/**
 * GST document rendering — persisted tax invoices & credit notes.
 *
 * Unlike `invoice-pdf.ts` (the legacy flow that re-derives an invoice from
 * LIVE order data every time), these documents are FROZEN: they were minted
 * by the backend the moment money moved (payment captured → invoice; refund
 * confirmed → credit note) and are immutable from then on. This module only
 * *renders* what the API returns — every field (seller GSTIN, SAC, tax rate,
 * amounts in paise, dates) comes from the stored record, never recomputed
 * here and never hardcoded.
 *
 * Money crosses the wire as integer PAISE (`*Paise` fields); we format ₹
 * for display. Documents render as a self-contained HTML fragment (scoped
 * `.gst-doc` styles) and rasterize to a deterministic A4 PDF via the same
 * html2canvas → jsPDF assembly as the legacy invoice (no `Date.now()` in
 * the render path — same record in, same bytes out).
 */

// ─── Wire types (mirror be/app/api/documents.py) ─────────────────────────────

export interface GstSeller {
  name: string | null;
  gstin: string | null;
  address: string | null;
  state: string | null;
  sac: string | null;
}

export interface GstBuyer {
  name: string | null;
  address: string | null;
  gstin: string | null;
}

export interface GstInvoiceAmounts {
  totalPaise: number;
  taxablePaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  rateBp: number;
  reversedPaise: number;
  netPaise: number;
}

/** A persisted tax invoice (kind === "invoice"). */
export interface GstInvoice {
  id: string;
  kind: "invoice";
  number: string;
  fy: string;
  issueTs: string | null;
  /** "dd MMM yyyy" in IST, pre-formatted by the backend. */
  dateIst: string | null;
  orderId: string | null;
  orderNumber: string | null;
  transactionId: string | null;
  seller: GstSeller;
  buyer: GstBuyer;
  placeOfSupply: string | null;
  taxKind: string | null;
  amounts: GstInvoiceAmounts;
  totalInWords: string | null;
  description: string | null;
  paymentRef: string | null;
  paymentReceivedNote: string | null;
  /** Printed on the Terms line: "Paid in Full" | "Due on Receipt" | "Partially Paid". */
  paymentTerms?: string | null;
  voided: boolean;
  voidReason: string | null;
}

/** A persisted credit note (kind === "credit_note"). */
export interface GstCreditNote {
  id: string;
  kind: "credit_note";
  number: string;
  fy: string;
  issueTs: string | null;
  dateIst: string | null;
  orderId: string | null;
  orderNumber: string | null;
  transactionId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountPaise: number;
  amountInWords: string | null;
  reason: string | null;
  note: string | null;
}

export type GstDocument = GstInvoice | GstCreditNote;

export interface OrderDocuments {
  orderId: string;
  orderNumber: string | null;
  invoices: GstInvoice[];
  creditNotes: GstCreditNote[];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Paise → "1,234.50" (Indian grouping, 2 decimals, sign preserved). */
export function paiseToAmountString(paise: number | null | undefined): string {
  const p = paise ?? 0;
  const neg = p < 0;
  const abs = Math.abs(p) / 100;
  const s = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return neg ? `(-) ${s}` : s;
}

/** Paise → "₹1,234.50". */
export function paiseToRupeeString(paise: number | null | undefined): string {
  return `₹${paiseToAmountString(paise)}`;
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Shared CSS (scoped to .gst-doc — no body/@page globals) ─────────────────

const DOC_CSS = `
  .gst-doc, .gst-doc * { box-sizing: border-box; }
  .gst-doc {
    width: 794px;              /* A4 @ 96dpi */
    min-height: 1123px;
    padding: 54px 56px 48px;
    background: #ffffff;
    position: relative;
    font-family: "Inter", "Segoe UI", Arial, sans-serif;
    color: #1a2230;
  }
  .gst-doc .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .gst-doc .seller .name { font-size: 17px; font-weight: 700; color: #083068; line-height: 1.3; }
  .gst-doc .seller .addr { font-size: 11.5px; color: #5b6573; line-height: 1.5; margin-top: 4px; }
  .gst-doc .seller .gstin, .gst-doc .seller .email { font-size: 11.5px; color: #5b6573; line-height: 1.5; }
  .gst-doc .doc { text-align: right; }
  .gst-doc .doc .title { font-size: 22px; font-weight: 800; color: #083068; letter-spacing: 0.5px; }
  .gst-doc .doc .inv-no { font-size: 13px; color: #1a2230; margin-top: 6px; font-weight: 600; }

  .gst-doc .meta-row { display: flex; justify-content: space-between; margin-top: 26px; }
  .gst-doc .bill-to { max-width: 340px; }
  .gst-doc .bill-to .lbl, .gst-doc .meta .lbl {
    font-size: 10px; color: #8a93a0; text-transform: uppercase; letter-spacing: 0.7px;
  }
  .gst-doc .bill-to .cust-name { font-size: 13.5px; font-weight: 600; color: #1a2230; margin-top: 3px; }
  .gst-doc .bill-to .cust-addr { font-size: 11px; color: #5b6573; line-height: 1.5; margin-top: 2px; white-space: pre-line; }
  .gst-doc .bill-to .pos { font-size: 11px; color: #5b6573; margin-top: 6px; }
  .gst-doc .meta { text-align: right; }
  .gst-doc .meta .row { margin-bottom: 7px; }
  .gst-doc .meta .row .k { font-size: 10px; color: #8a93a0; text-transform: uppercase; letter-spacing: 0.7px; }
  .gst-doc .meta .row .v { font-size: 12.5px; color: #1a2230; font-weight: 600; }

  .gst-doc table.items {
    width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 11.5px;
  }
  .gst-doc table.items th {
    background: #f3f5f8; color: #5b6573; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px;
    padding: 9px 8px; border-bottom: 1.5px solid #d8dee6; text-align: left;
  }
  .gst-doc table.items th.num, .gst-doc table.items td.num { text-align: right; }
  .gst-doc table.items th:first-child, .gst-doc table.items td:first-child { text-align: center; width: 28px; }
  .gst-doc table.items td { padding: 11px 8px; border-bottom: 1px solid #eef1f5; vertical-align: top; }
  .gst-doc .line-label { font-weight: 600; font-size: 12px; }
  .gst-doc .line-sub { font-size: 9.5px; color: #8a93a0; margin-top: 2px; }
  .gst-doc .unit { font-size: 9px; color: #8a93a0; }
  .gst-doc .amt { font-weight: 600; }

  .gst-doc .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
  .gst-doc .totals { width: 300px; font-size: 12px; }
  .gst-doc .tot-row { display: flex; justify-content: space-between; padding: 5px 0; color: #5b6573; }
  .gst-doc .tot-row .mono { font-family: "IBM Plex Mono", "Menlo", monospace; }
  .gst-doc .tot-row.grand { border-top: 1.5px solid #d8dee6; margin-top: 4px; padding-top: 9px; }
  .gst-doc .tot-row.grand span:first-child {
    font-weight: 700; color: #083068; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px;
  }
  .gst-doc .tot-row.grand span:last-child {
    font-weight: 800; color: #083068; font-size: 15px; font-family: "IBM Plex Mono", "Menlo", monospace;
  }
  .gst-doc .tot-row.neg span:last-child { color: #a33d00; }

  .gst-doc .words {
    margin-top: 14px; text-align: right;
    font-size: 10.5px; color: #5b6573; font-style: italic;
  }
  .gst-doc .words b { color: #1a2230; font-style: normal; font-weight: 600; }

  .gst-doc .refs { margin-top: 18px; font-size: 11px; color: #5b6573; line-height: 1.6; }
  .gst-doc .refs .k { font-weight: 600; color: #1a2230; }

  .gst-doc .footer {
    position: absolute; bottom: 40px; left: 56px; right: 56px;
    border-top: 1px solid #eef1f5; padding-top: 14px; text-align: center;
    font-size: 11px; color: #8a93a0;
  }
  .gst-doc .footer .accent { color: #d06010; font-weight: 600; }

  .gst-doc .void-band {
    border: 2px solid #d06010; color: #d06010; border-radius: 8px;
    text-align: center; font-weight: 800; letter-spacing: 2px;
    padding: 8px; margin-top: 18px; font-size: 14px; text-transform: uppercase;
  }
`;

function sellerBlock(seller: GstSeller): string {
  return `
    <div class="name">${escapeHtml(seller.name) || "Draep"}</div>
    ${seller.address ? `<div class="addr">${escapeHtml(seller.address)}</div>` : ""}
    ${seller.gstin ? `<div class="gstin">GSTIN ${escapeHtml(seller.gstin)}</div>` : ""}
    ${seller.state ? `<div class="gstin">State: ${escapeHtml(seller.state)}</div>` : ""}
  `;
}

function buyerBlock(buyer: GstBuyer, placeOfSupply: string | null): string {
  return `
    <div class="lbl">Bill To</div>
    <div class="cust-name">${escapeHtml(buyer.name) || "Valued Customer"}</div>
    ${buyer.address ? `<div class="cust-addr">${escapeHtml(buyer.address)}</div>` : ""}
    ${buyer.gstin ? `<div class="cust-addr" style="margin-top:4px">GSTIN ${escapeHtml(buyer.gstin)}</div>` : ""}
    ${placeOfSupply ? `<div class="pos">Place of Supply: ${escapeHtml(placeOfSupply)}</div>` : ""}
  `;
}

// ─── Invoice HTML ────────────────────────────────────────────────────────────

export function buildGstInvoiceHtml(inv: GstInvoice): string {
  const a = inv.amounts;
  const ratePct = (a.rateBp / 100).toFixed(a.rateBp % 100 === 0 ? 0 : 2);
  const taxRows =
    inv.taxKind === "cgst_sgst"
      ? `
        <div class="tot-row"><span>CGST (${ratePct}% on ₹${paiseToAmountString(a.taxablePaise)})</span><span class="mono">${paiseToAmountString(a.cgstPaise)}</span></div>
        <div class="tot-row"><span>SGST (${ratePct}%)</span><span class="mono">${paiseToAmountString(a.sgstPaise)}</span></div>`
      : `
        <div class="tot-row"><span>IGST (${ratePct}%)</span><span class="mono">${paiseToAmountString(a.taxPaise)}</span></div>`;

  const reversalRows =
    a.reversedPaise > 0
      ? `
        <div class="tot-row neg"><span>Reversed (credit notes)</span><span class="mono">− ${paiseToAmountString(a.reversedPaise)}</span></div>
        <div class="tot-row grand"><span>Net</span><span>₹${paiseToAmountString(a.netPaise)}</span></div>`
      : "";

  const metaRows = [
    inv.dateIst ? `<div class="row"><div class="k">Invoice Date</div><div class="v">${escapeHtml(inv.dateIst)}</div></div>` : "",
    inv.orderNumber
      ? `<div class="row"><div class="k">Order</div><div class="v">#${escapeHtml(inv.orderNumber)}</div></div>`
      : "",
    `<div class="row"><div class="k">Terms</div><div class="v">${escapeHtml(inv.paymentTerms ?? "Due on Receipt")}</div></div>`,
  ].join("");

  const refs = [
    inv.paymentRef ? `<span class="k">Payment reference:</span> ${escapeHtml(inv.paymentRef)}` : "",
    inv.paymentReceivedNote ? `<span class="k">Payment note:</span> ${escapeHtml(inv.paymentReceivedNote)}` : "",
  ]
    .filter(Boolean)
    .map((r) => `<div>${r}</div>`)
    .join("");

  return `<style>${DOC_CSS}</style>
<div class="gst-doc">
  <div class="header">
    <div class="seller">${sellerBlock(inv.seller)}</div>
    <div class="doc">
      <div class="title">TAX INVOICE</div>
      <div class="inv-no"># ${escapeHtml(inv.number)}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="bill-to">${buyerBlock(inv.buyer, inv.placeOfSupply)}</div>
    <div class="meta">${metaRows}</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th class="num">SAC</th>
        <th class="num">Qty</th>
        <th class="num">Taxable</th>
        <th class="num">Tax</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="num">1</td>
        <td class="desc">
          <div class="line-label">${escapeHtml(inv.description) || "Custom garment stitching services"}</div>
          <div class="line-sub">Tax-inclusive; ${ratePct}% GST</div>
        </td>
        <td class="num">${escapeHtml(inv.seller.sac) || "—"}</td>
        <td class="num">1.00<br><span class="unit">NOS</span></td>
        <td class="num">${paiseToAmountString(a.taxablePaise)}</td>
        <td class="num">${paiseToAmountString(a.taxPaise)}</td>
        <td class="num amt">${paiseToAmountString(a.totalPaise)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row"><span>Taxable Value</span><span class="mono">₹${paiseToAmountString(a.taxablePaise)}</span></div>
      ${taxRows}
      <div class="tot-row grand"><span>Total</span><span>₹${paiseToAmountString(a.totalPaise)}</span></div>
      ${reversalRows}
    </div>
  </div>

  <div class="words">
    Total In Words: <b>${escapeHtml(inv.totalInWords) || "—"}</b>
  </div>

  ${refs ? `<div class="refs">${refs}</div>` : ""}

  ${inv.voided ? `<div class="void-band">Void — ${escapeHtml(inv.voidReason) || "not a valid invoice"}</div>` : ""}

  <div class="footer">
    Thank you for choosing <span class="accent">Draep</span>. This is a computer-generated tax invoice.
  </div>
</div>`;
}

// ─── Credit note HTML ────────────────────────────────────────────────────────

export function buildGstCreditNoteHtml(cn: GstCreditNote, seller: GstSeller): string {
  const metaRows = [
    cn.dateIst ? `<div class="row"><div class="k">Date</div><div class="v">${escapeHtml(cn.dateIst)}</div></div>` : "",
    cn.orderNumber ? `<div class="row"><div class="k">Order</div><div class="v">#${escapeHtml(cn.orderNumber)}</div></div>` : "",
  ].join("");

  const reasonLine = cn.reason
    ? `<div class="line-sub">Reason: ${escapeHtml(cn.reason)}</div>`
    : "";

  return `<style>${DOC_CSS}</style>
<div class="gst-doc">
  <div class="header">
    <div class="seller">${sellerBlock(seller)}</div>
    <div class="doc">
      <div class="title">CREDIT NOTE</div>
      <div class="inv-no"># ${escapeHtml(cn.number)}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="bill-to">
      <div class="lbl">Against Invoice</div>
      <div class="cust-name">${escapeHtml(cn.invoiceNumber) || "—"}</div>
    </div>
    <div class="meta">${metaRows}</div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="num">1</td>
        <td class="desc">
          <div class="line-label">Reversal against invoice ${escapeHtml(cn.invoiceNumber) || ""}</div>
          ${reasonLine}
          ${cn.note ? `<div class="line-sub">${escapeHtml(cn.note)}</div>` : ""}
        </td>
        <td class="num">1.00<br><span class="unit">NOS</span></td>
        <td class="num amt">− ₹${paiseToAmountString(cn.amountPaise)}</td>
      </tr>
    </tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row grand neg"><span>Credit Amount</span><span>− ₹${paiseToAmountString(cn.amountPaise)}</span></div>
    </div>
  </div>

  <div class="words">
    Amount In Words: <b>${escapeHtml(cn.amountInWords) || "—"}</b>
  </div>

  <div class="footer">
    Issued under Section 34 of the CGST Act. <span class="accent">Draep</span> · computer-generated credit note.
  </div>
</div>`;
}

// ─── HTML for any document (credit notes need a seller — from the order's
//     invoices, or a fallback parameter) ──────────────────────────────────────

export function buildGstDocumentHtml(
  doc: GstDocument,
  fallbackSeller?: GstSeller,
): string {
  if (doc.kind === "invoice") return buildGstInvoiceHtml(doc);
  return buildGstCreditNoteHtml(doc, fallbackSeller ?? EMPTY_SELLER);
}

const EMPTY_SELLER: GstSeller = {
  name: null,
  gstin: null,
  address: null,
  state: null,
  sac: null,
};

// ─── PDF assembly (html2canvas → jsPDF, same approach as invoice-pdf.ts) ─────

/** Yield to the browser so pending paints settle before rasterizing. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface GstPdfProgress {
  (label: string): void;
}

/** Render a persisted GST document and download it as a one-page A4 PDF.
 *  Deterministic: everything shown comes from the stored record — no
 *  Date.now(), no random ids — so the same record rasterizes to the same
 *  bytes every time. */
export async function generateGstDocumentPdf(
  doc: GstDocument,
  fallbackSeller?: GstSeller,
  onProgress?: GstPdfProgress,
): Promise<void> {
  const html = buildGstDocumentHtml(doc, fallbackSeller);

  const [{ default: html2canvas }, jspdfMod, { default: saveAs }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    import("file-saver"),
  ]);
  const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

  const holder = document.createElement("div");
  holder.setAttribute("data-gst-doc-holder", "");
  holder.style.position = "fixed";
  holder.style.zIndex = "-9999";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.width = "794px";
  holder.style.background = "#ffffff";
  holder.style.pointerEvents = "none";
  holder.innerHTML = html;
  document.body.appendChild(holder);

  try {
    const pageEl = holder.querySelector<HTMLElement>(".gst-doc");
    if (!pageEl) throw new Error("No document page element found");

    onProgress?.("Rendering document…");
    await nextPaint();

    const canvas = await html2canvas(pageEl, {
      scale: 3,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      width: pageEl.offsetWidth,
      height: pageEl.offsetHeight,
      windowWidth: 794,
    });

    onProgress?.("Saving file…");
    await nextPaint();

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const imgW = pageWidthMm;
    const imgH = (canvas.height * imgW) / canvas.width;
    pdf.addImage(imgData, "JPEG", 0, 0, imgW, Math.min(imgH, pageHeightMm));

    const kindLabel = doc.kind === "invoice" ? "Invoice" : "CreditNote";
    const safeNum = (doc.number || kindLabel).replace(/[^\w-]/g, "_");
    saveAs(pdf.output("blob"), `DRAEP-${kindLabel}-${safeNum}.pdf`);
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}
