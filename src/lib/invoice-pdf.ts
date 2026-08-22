/**
 * Tax Invoice PDF — downloadable GST invoice.
 *
 * Mirrors the structure of `job-pdf.ts` but is self-contained (own small
 * html2canvas → jsPDF assembly loop). Produces a one-page A4 "TAX INVOICE"
 * matching the reference sample (be/INV-000008.pdf, a Zoho-style GST invoice).
 *
 * Tax model — the order grand total is treated as TAX-INCLUSIVE and the GST
 * component is back-calculated (reverse-applied):
 *   lineTaxable = round(lineTotal / (1 + GST_RATE), 2)
 *   subTotal    = Σ lineTaxable      (over garment + adjustment lines)
 *   igst        = grandTotal − subTotal   ← absorbs rounding so the invoice
 *                                           always reconciles to the rupee
 *   total       = grandTotal         (≡ order.total_price)
 *
 * Everything the invoice needs is already loaded on the order detail page, so
 * generateInvoicePdf() triggers no network calls.
 */

import type {
  AddressRow,
  UserRow,
} from "./admin-api";
import { buildUpiPayUrl, UPI_VPA } from "./upi";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Seller / company block. Sourced from the reference invoice
 *  (be/INV-000008.pdf). Move to backend config if it ever needs to vary. */
const SELLER = {
  name: "Draep Technologies Pvt. Ltd.",
  addressLines: ["Uttar Pradesh", "India"],
  gstin: "09AAMCD3592M1ZX",
  email: "info@draep.com",
};

/** Flat GST rate back-calculated from the tax-inclusive total.
 *  5% matches the reference invoice (₹349 → ₹332.38 + ₹16.62). */
const GST_RATE = 0.05;

/** Default HSN/SAC shown on every line. No per-garment HSN exists today. */
const HSN_SAC = "998822";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceLine {
  /** Human label, e.g. "Tailored Shirt" or "Festive discount". */
  label: string;
  /** Signed, tax-inclusive rupees. Negative for discounts. */
  total: number;
}

/** One captured payment, with the note recorded when it was logged. */
export interface InvoicePayment {
  /** Captured rupees. */
  amount: number;
  /** The note typed when recording the payment, if any. */
  note: string | null;
}

export interface InvoiceInput {
  /** Display number, e.g. "INV-DRAEP-0123". */
  invoiceNumber: string;
  /** Raw order number (e.g. "12333") — used for the UPI QR note "Order#…". */
  orderNumber: string | null;
  customer: UserRow | null;
  address: AddressRow | null;
  /** One line per garment order — effective (adjustment-inclusive) totals. */
  garmentLines: InvoiceLine[];
  /** Order-level discounts/fees (garment_order_id IS NULL). */
  adjustmentLines: InvoiceLine[];
  /** Captured payments — one entry each, carrying its recorded note. */
  payments: InvoicePayment[];
}

interface ComputedInvoice {
  lineRows: {
    label: string;
    taxable: number; // pre-tax (Rate column)
    igst: number; // tax (IGST column)
    amount: number; // tax-inclusive line total
  }[];
  subTotal: number;
  igst: number;
  total: number; // grand total (tax-inclusive)
  paymentMade: number;
  balanceDue: number;
}

// ─── Tax back-tracking ────────────────────────────────────────────────────────

/** Reverse-calculate GST from a tax-inclusive amount. `amount` may be negative
 *  (discounts) — the tax tracks its sign so sub-lines stay additive. */
function splitTax(amount: number, rate: number): { taxable: number; igst: number } {
  // round half-up to 2 decimals, preserving sign.
  const taxable = round2(amount / (1 + rate));
  return { taxable, igst: round2(amount - taxable) };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Compute the full invoice ledger.
 *
 *  The grand total is derived ADDITIVELY from the line items the caller passes
 *  (garment effective totals + order-level adjustments) — NOT from the stored
 *  ``order.total_price``. The stored column is a denormalized cache that can
 *  drift out of sync (it did, systemically); building the total from the same
 *  components the line items use guarantees the invoice total always equals
 *  the sum of its own lines, regardless of any backend staleness.
 *
 *  The IGST line = grandTotal − subTotal so rounding always reconciles. */
function computeInvoice(input: InvoiceInput): ComputedInvoice {
  const grandTotal = round2(
    [...input.garmentLines, ...input.adjustmentLines].reduce(
      (s, ln) => s + (ln.total ?? 0),
      0,
    ),
  );

  const allLines = [...input.garmentLines, ...input.adjustmentLines];
  const lineRows = allLines.map((ln) => {
    const { taxable, igst } = splitTax(ln.total, GST_RATE);
    return { label: ln.label, taxable, igst, amount: round2(ln.total) };
  });

  const subTotal = round2(lineRows.reduce((s, r) => s + r.taxable, 0));
  // The tax line absorbs the sum of per-line rounding so the column always
  // reads: subTotal + IGST = grandTotal, exactly.
  const igst = round2(grandTotal - subTotal);
  const paymentMade = round2(input.payments.reduce((s, p) => s + (p.amount ?? 0), 0));
  const balanceDue = round2(grandTotal - paymentMade);

  return {
    lineRows,
    subTotal,
    igst,
    total: grandTotal,
    paymentMade,
    balanceDue,
  };
}

// ─── Number → Indian English words ────────────────────────────────────────────

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (h) out += ONES[h] + " Hundred";
  if (rest) out += (h ? " " : "") + twoDigits(rest);
  return out;
}

/** Convert a non-negative rupee amount to Indian-system English words.
 *  e.g. 349 → "Three Hundred Forty-Nine", 125000 → "One Lakh Twenty-Five Thousand". */
function numberToIndianWords(amount: number): string {
  const rupees = Math.round(amount);
  if (rupees === 0) return "Zero";

  let n = rupees;
  const parts: string[] = [];

  // Indian grouping: crore, lakh, thousand, hundreds.
  const crore = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundreds = n;

  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds) parts.push(threeDigits(hundreds));

  return parts.join(" ").trim();
}

// ─── Indian state → GST state code ────────────────────────────────────────────

/** Two-digit GST state codes. Used for "Place of Supply: <state> (<code>)". */
const STATE_CODE_MAP: Record<string, string> = {
  "andhra pradesh": "37",
  "arunachal pradesh": "12",
  assam: "18",
  bihar: "10",
  chhattisgarh: "22",
  goa: "30",
  gujarat: "24",
  haryana: "06",
  "himachal pradesh": "02",
  jharkhand: "20",
  karnataka: "29",
  kerala: "32",
  "madhya pradesh": "23",
  maharashtra: "27",
  manipur: "14",
  meghalaya: "17",
  mizoram: "15",
  nagaland: "13",
  odisha: "21",
  punjab: "03",
  rajasthan: "08",
  sikkim: "11",
  "tamil nadu": "33",
  telangana: "36",
  tripura: "16",
  "uttar pradesh": "09",
  uttarakhand: "05",
  "west bengal": "19",
  "andaman and nicobar islands": "35",
  chandigarh: "04",
  "dadra and nagar haveli and daman and diu": "26",
  delhi: "07",
  "jammu and kashmir": "01",
  ladakh: "38",
  lakshadweep: "31",
  puducherry: "34",
};

function stateCode(state: string | null | undefined): string | null {
  if (!state) return null;
  return STATE_CODE_MAP[state.trim().toLowerCase()] ?? null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  // Two decimals (invoice style), Indian grouping. Negative → parens-ish via "(-)".
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return neg ? `(-) ${s}` : s;
}

function fmtRupee(n: number): string {
  return `₹${fmtMoney(n)}`;
}

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Invoice HTML ─────────────────────────────────────────────────────────────

function buildInvoiceHtml(
  input: InvoiceInput,
  inv: ComputedInvoice,
  logoDataUrl?: string | null,
  upiQrDataUrl?: string | null,
  payUrl?: string | null,
): string {
  const today = new Date();
  const dateStr = fmtDate(today);
  const { customer, address } = input;

  // Logo: only render when we successfully inlined it as a data URL. Keeping
  // it out of the markup entirely (rather than an empty <img>) avoids
  // html2canvas capturing a broken-image box when the fetch fails.
  const logoHtml = logoDataUrl
    ? `<img class="logo" src="${logoDataUrl}" alt="${escapeHtml(SELLER.name)} logo" />`
    : "";

  // Customer block
  const custName = escapeHtml(customer?.name) || "Valued Customer";
  const addrLines = address
    ? [
        address.address_line_1,
        address.address_line_2,
        [address.city, address.state].filter(Boolean).join(", "),
        address.pincode,
      ]
        .filter(Boolean)
        .map((l) => `<div>${escapeHtml(String(l))}</div>`)
        .join("")
    : "";

  const placeOfSupply = address?.state
    ? `Place Of Supply: ${escapeHtml(address.state)}${
        stateCode(address.state) ? ` (${stateCode(address.state)})` : ""
      }`
    : "";

  const sellerLines = SELLER.addressLines
    .map((l) => `<div>${escapeHtml(l)}</div>`)
    .join("");

  // Line item rows
  const itemRows = inv.lineRows
    .map((r, i) => {
      const igstPct = `${(GST_RATE * 100).toFixed(0)}%`;
      return `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="desc">
          <div class="line-label">${escapeHtml(r.label)}</div>
          <div class="igst-sub">${igstPct} IGST</div>
        </td>
        <td class="num">${HSN_SAC}</td>
        <td class="num">1.00<br><span class="unit">NOS</span></td>
        <td class="num">${fmtMoney(r.taxable)}</td>
        <td class="num">${fmtMoney(r.igst)}</td>
        <td class="num amt">${fmtMoney(r.amount)}</td>
      </tr>`;
    })
    .join("");

  // One "Payment Made" row per captured payment, with the note (if any) that
  // was recorded when the payment was logged, shown under the amount.
  const paymentMadeRow =
    inv.paymentMade > 0
      ? input.payments
          .filter((p) => (p.amount ?? 0) !== 0)
          .map((p) => {
            const noteText = p.note?.trim();
            return `<div class="tot-payment"><div class="tot-row"><span>Payment Made</span><span class="neg">${fmtRupee(
              -(p.amount ?? 0),
            )}</span></div>${
              noteText ? `<div class="tot-note">${escapeHtml(noteText)}</div>` : ""
            }</div>`;
          })
          .join("")
      : "";

  const words = numberToIndianWords(inv.total);
  const dueLabel = inv.balanceDue <= 0.5 ? "Paid" : "Balance Due";
  const dueClass = inv.balanceDue <= 0.5 ? "paid" : "due";

  // UPI QR carries the outstanding amount; when fully paid it falls back to
  // the grand total so the QR never has am=0.00 (UPI apps reject that).
  const qrAmount = inv.balanceDue > 0.5 ? inv.balanceDue : inv.total;
  // Pay button, in two shapes from one builder:
  //  • web (payUrl set) — a REAL anchor; clicking opens the visitor's UPI app
  //  • PDF (no payUrl)  — an EMPTY navy pill; generateInvoicePdf overlays
  //    native vector text + a link annotation on this exact rect, because
  //    html2canvas/JPEG smudges small white-on-navy labels baked into the
  //    raster (the bug this split avoids).
  const payBtnHtml = payUrl
    ? `<a class="upi-btn" href="${payUrl}">Pay via UPI &rarr;</a>`
    : `<div class="upi-btnrow"><div class="upi-pill"></div></div>`;
  const upiQrBlock =
    upiQrDataUrl && input.orderNumber
      ? `<div class="upi-row">
          <img class="qr-img" src="${upiQrDataUrl}" alt="UPI payment QR" />
          <div class="qr-text">
            <div class="qr-title">Scan to pay ${fmtRupee(qrAmount)}</div>
            <div class="qr-sub">via any UPI app &bull; ${escapeHtml(UPI_VPA)}</div>
            ${payBtnHtml}
          </div>
        </div>`
      : "";

  // A FRAGMENT (style + .page div), not a full HTML document: the same string
  // is embedded inline by the public /invoice page, so every rule below is
  // scoped to a class — no `body`/`@page` globals that would hijack the host
  // page. The PDF path injects it into an off-screen holder the same way.
  return `<style>
  .page, .page * { box-sizing: border-box; }
  .page {
    width: 794px;   /* A4 @ 96dpi */
    min-height: 1123px;
    padding: 54px 56px 48px;
    background: #ffffff;
    position: relative;
    font-family: "Inter", "Segoe UI", Arial, sans-serif;
    color: #1a2230;
  }

  /* ── Header ── */
  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .seller .name {
    font-size: 17px; font-weight: 700; color: #083068; line-height: 1.3;
  }
  .seller .addr { font-size: 11.5px; color: #5b6573; line-height: 1.5; margin-top: 4px; }
  .seller .gstin, .seller .email { font-size: 11.5px; color: #5b6573; line-height: 1.5; }
  .seller .logo {
    display: block;
    width: 132px;       /* fixed width; height auto keeps the aspect ratio */
    height: auto;
    margin-bottom: 10px;
  }

  .doc { text-align: right; }
  .doc .title { font-size: 22px; font-weight: 800; color: #083068; letter-spacing: 0.5px; }
  .doc .inv-no { font-size: 13px; color: #1a2230; margin-top: 6px; font-weight: 600; }

  /* ── Balance status chip (below the items table) ──
     Plain block inside a flex-end wrapper — the same layout primitives as the
     totals column. Do NOT use display:inline-block here: html2canvas drops
     the text nodes of inline-blocks inside right-aligned parents. */
  .balance-wrap { display: flex; justify-content: flex-end; margin-top: 16px; }
  .balance-box {
    text-align: right;
    background: ${inv.balanceDue <= 0.5 ? "#e9f7ee" : "#fff4ea"};
    border: 1px solid ${inv.balanceDue <= 0.5 ? "#bfe6cd" : "#f5c89a"};
    border-radius: 8px; padding: 10px 18px;
  }
  .balance-box .lbl { font-size: 10px; color: #5b6573; text-transform: uppercase; letter-spacing: 0.6px; }
  .balance-box .val {
    font-size: 18px; font-weight: 700; margin-top: 2px;
    color: ${inv.balanceDue <= 0.5 ? "#1a7d42" : "#d06010"};
    font-family: "IBM Plex Mono", "Menlo", monospace;
  }

  /* ── Meta + parties ── */
  .meta-row { display: flex; justify-content: space-between; margin-top: 26px; }
  .bill-to { max-width: 340px; }
  .bill-to .lbl, .meta .lbl {
    font-size: 10px; color: #8a93a0; text-transform: uppercase; letter-spacing: 0.7px;
  }
  .bill-to .cust-name { font-size: 13.5px; font-weight: 600; color: #1a2230; margin-top: 3px; }
  .bill-to .cust-addr { font-size: 11px; color: #5b6573; line-height: 1.5; margin-top: 2px; }
  .bill-to .pos { font-size: 11px; color: #5b6573; margin-top: 6px; }

  .meta { text-align: right; }
  .meta .row { margin-bottom: 7px; }
  .meta .row .k { font-size: 10px; color: #8a93a0; text-transform: uppercase; letter-spacing: 0.7px; }
  .meta .row .v { font-size: 12.5px; color: #1a2230; font-weight: 600; }

  /* ── Items table ── */
  table.items {
    width: 100%; border-collapse: collapse; margin-top: 24px;
    font-size: 11.5px;
  }
  table.items th {
    background: #f3f5f8; color: #5b6573; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px;
    padding: 9px 8px; border-bottom: 1.5px solid #d8dee6; text-align: left;
  }
  table.items th.num, table.items td.num { text-align: right; }
  table.items th:first-child, table.items td:first-child { text-align: center; width: 28px; }
  table.items td { padding: 11px 8px; border-bottom: 1px solid #eef1f5; vertical-align: top; }
  table.items td.desc { color: #1a2230; }
  .line-label { font-weight: 600; font-size: 12px; }
  .igst-sub { font-size: 9.5px; color: #8a93a0; margin-top: 2px; }
  .unit { font-size: 9px; color: #8a93a0; }
  .amt { font-weight: 600; }

  /* ── Totals column ── */
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
  .totals { width: 280px; font-size: 12px; }
  .tot-row { display: flex; justify-content: space-between; padding: 5px 0; color: #5b6573; }
  .tot-row .neg { color: #1a7d42; font-family: "IBM Plex Mono", "Menlo", monospace; }
  .tot-payment + .tot-payment { margin-top: 2px; }
  .tot-note {
    font-size: 9.5px; color: #8a93a0; font-style: italic;
    text-align: right; margin: -3px 0 4px;
  }
  .tot-row.grand { border-top: 1.5px solid #d8dee6; margin-top: 4px; padding-top: 9px; }
  .tot-row.grand span:first-child { font-weight: 700; color: #083068; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  .tot-row.grand span:last-child { font-weight: 800; color: #083068; font-size: 15px; font-family: "IBM Plex Mono", "Menlo", monospace; }
  .tot-row .mono { font-family: "IBM Plex Mono", "Menlo", monospace; }
  .tot-row.balance span:first-child { font-weight: 700; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  .tot-row.balance span:last-child { font-weight: 800; font-size: 15px; font-family: "IBM Plex Mono", "Menlo", monospace; }
  .tot-row.balance.paid span:last-child { color: #1a7d42; }
  .tot-row.balance.due span:last-child { color: #d06010; }

  .words {
    margin-top: 14px; text-align: right;
    font-size: 10.5px; color: #5b6573; font-style: italic;
  }
  .words b { color: #1a2230; font-style: normal; font-weight: 600; }

  /* ── UPI payment QR ── plain block/flex/img primitives only (html2canvas
     drops text inside inline-blocks — see the balance-box note above). */
  .upi-row { display: flex; align-items: center; gap: 14px; margin-top: 20px; }
  .qr-img {
    display: block; width: 106px; height: 106px;
    border: 1px solid #eef1f5; border-radius: 8px; padding: 5px; background: #fff;
  }
  .qr-text .qr-title { font-size: 12.5px; color: #1a2230; font-weight: 700; }
  .qr-text .qr-sub { font-size: 10px; color: #8a93a0; margin-top: 3px; }
  /* Web pay button — a REAL anchor (public /invoice page only; the PDF path
     passes no payUrl and never renders this shape), so tapping it hands the
     upi:// deep link to the OS and opens the visitor's UPI app. */
  .qr-text .upi-btn {
    display: inline-block; margin-top: 10px;
    background: #083068; color: #ffffff; text-decoration: none;
    border-radius: 8px; padding: 10px 22px;
    font-size: 14px; font-weight: 700; line-height: 1.2;
  }
  /* PDF pay button — an EMPTY fixed-size pill (160×40) so its geometry is
     deterministic for generateInvoicePdf's vector-text + link-annotation
     overlay. Deliberately carries no text: html2canvas → JPEG drops/smudges
     small white-on-navy labels. */
  .upi-btnrow { display: flex; justify-content: flex-start; margin-top: 10px; }
  .upi-btnrow .upi-pill {
    background: #083068; border-radius: 8px;
    width: 160px; height: 40px;
  }

  .footer {
    position: absolute; bottom: 40px; left: 56px; right: 56px;
    border-top: 1px solid #eef1f5; padding-top: 14px; text-align: center;
    font-size: 11px; color: #8a93a0;
  }
  .footer .accent { color: #d06010; font-weight: 600; }
</style>
<div class="page">

  <div class="header">
    <div class="seller">
      ${logoHtml}
      <div class="name">${escapeHtml(SELLER.name)}</div>
      <div class="addr">${sellerLines}</div>
      <div class="gstin">GSTIN ${escapeHtml(SELLER.gstin)}</div>
      <div class="email">${escapeHtml(SELLER.email)}</div>
    </div>
    <div class="doc">
      <div class="title">TAX INVOICE</div>
      <div class="inv-no"># ${escapeHtml(input.invoiceNumber)}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="bill-to">
      <div class="lbl">Bill To</div>
      <div class="cust-name">${custName}</div>
      <div class="cust-addr">${addrLines}</div>
      ${placeOfSupply ? `<div class="pos">${placeOfSupply}</div>` : ""}
    </div>
    <div class="meta">
      <div class="row"><div class="k">Invoice Date</div><div class="v">${dateStr}</div></div>
      <div class="row"><div class="k">Terms</div><div class="v">Due on Receipt</div></div>
      <div class="row"><div class="k">Due Date</div><div class="v">${dateStr}</div></div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th class="num">HSN/SAC</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">IGST</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || `<tr><td colspan="7" style="text-align:center;color:#8a93a0;padding:18px;">No line items</td></tr>`}
    </tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row"><span>Sub Total</span><span class="mono">${fmtMoney(inv.subTotal)}</span></div>
      <div class="tot-row"><span>IGST (${(GST_RATE * 100).toFixed(0)}%)</span><span class="mono">${fmtMoney(inv.igst)}</span></div>
      <div class="tot-row grand"><span>Total</span><span>${fmtRupee(inv.total)}</span></div>
      ${paymentMadeRow}
      <div class="tot-row balance ${dueClass}"><span>${dueLabel}</span><span>${fmtRupee(inv.balanceDue)}</span></div>
    </div>
  </div>

  <div class="balance-wrap">
    <div class="balance-box">
      <div class="lbl">${dueLabel}</div>
      <div class="val">${fmtRupee(inv.balanceDue)}</div>
    </div>
  </div>

  <div class="words">
    Total In Words: <b>Indian Rupee ${words} Only</b>
  </div>

  ${upiQrBlock}

  <div class="footer">
    Thank you for choosing <span class="accent">Draep</span>. We're happy to serve you again.
  </div>

</div>`;
}

// ─── Assembly: HTML → canvas → PDF ────────────────────────────────────────────

/** Yield to the browser so it can paint pending UI updates. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export interface InvoicePdfProgress {
  (label: string): void;
}

/** Fetch a same-origin static asset (e.g. /logo.png from /public) and return it
 *  as a base64 data URL. Inlining the logo this way lets html2canvas render it
 *  deterministically — it bypasses the library's flaky image loader / CORS
 *  path entirely. Returns null on any failure so the invoice still renders
 *  without a logo rather than failing outright. */
async function fetchAssetAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** UPI deep link for an invoice's outstanding balance (falls back to the
 *  grand total when fully paid, so `am` is never 0.00 — UPI apps reject it).
 *  One source for the QR payload, the PDF's link annotation, and the public
 *  page's Pay via UPI button. */
export function invoiceUpiUrl(input: InvoiceInput): string | null {
  if (!input.orderNumber) return null;
  const inv = computeInvoice(input);
  const amount = inv.balanceDue > 0.5 ? inv.balanceDue : inv.total;
  return buildUpiPayUrl(amount, input.orderNumber);
}

/** Build the invoice HTML fragment (`<style>` + `.page`), with the logo and
 *  UPI QR inlined as data URLs. Shared by the PDF generator below and the
 *  public /invoice/[id] page so both render the identical invoice. Pass
 *  `opts.payUrl` (web view only) to render a real "Pay via UPI" anchor under
 *  the QR — the PDF path never passes it. */
export async function buildInvoiceDocumentHtml(
  input: InvoiceInput,
  opts?: { payUrl?: string | null },
): Promise<string> {
  const inv = computeInvoice(input);
  // Inline the logo as a data URL so html2canvas renders it reliably.
  const logoDataUrl = await fetchAssetAsDataUrl("/logo.png");

  // UPI payment QR (balance due → Order#<number>). Inlined as a data URL for
  // the same html2canvas-reliability reason as the logo. Failure just skips
  // the QR — the invoice still generates.
  const upiUrl = invoiceUpiUrl(input);
  let upiQrDataUrl: string | null = null;
  if (upiUrl) {
    try {
      const { toDataURL } = await import("qrcode");
      upiQrDataUrl = await toDataURL(upiUrl, {
        margin: 1,
        width: 440,
        errorCorrectionLevel: "M",
      });
    } catch {
      upiQrDataUrl = null;
    }
  }
  return buildInvoiceHtml(input, inv, logoDataUrl, upiQrDataUrl, opts?.payUrl ?? null);
}

/** Build the invoice HTML, rasterize it to an A4 PDF, and trigger a download.
 *  Fetches only the static logo asset (same-origin); all order data must
 *  already be loaded by the caller. */
export async function generateInvoicePdf(
  input: InvoiceInput,
  onProgress?: InvoicePdfProgress,
): Promise<void> {
  const html = await buildInvoiceDocumentHtml(input);
  // Deep-link target for the clickable QR annotation (must match the URL the
  // QR itself encodes).
  const upiUrl = invoiceUpiUrl(input);

  // Lazily import the heavy raster/PDF libs so they never bloat the main
  // bundle for callers that never build an invoice.
  const [{ default: html2canvas }, jspdfMod, { default: saveAs }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    import("file-saver"),
  ]);
  const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

  // Render off-screen in the live DOM (NOT an iframe — html2canvas needs to
  // walk the rendered tree). Sized to A4 portrait @ 96 DPI (794 × 1123 px).
  const holder = document.createElement("div");
  holder.setAttribute("data-invoice-holder", "");
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
    const pageEl = holder.querySelector<HTMLElement>(".page");
    if (!pageEl) throw new Error("No invoice page element found");

    onProgress?.("Rendering invoice…");
    await nextPaint();

    const canvas = await html2canvas(pageEl, {
      scale: 3, // 3x for crisp output (~216 DPI)
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

    // Pay-button label — VECTOR text, not part of the raster. The pill is
    // baked into the page image empty; the label is stamped here as real PDF
    // text so no html2canvas quirk or JPEG compression can touch it, and it
    // stays crisp at any zoom in every viewer. jsPDF's text y is the BASELINE,
    // so nudge down by ~cap-height/2 to vertically center inside the pill.
    // A /Link annotation over the same rect makes the pill clickable.
    const pillEl = holder.querySelector<HTMLElement>(".upi-pill");
    if (pillEl && upiUrl) {
      const mmPerPx = pageWidthMm / pageEl.offsetWidth;
      const pageRect = pageEl.getBoundingClientRect();
      const r = pillEl.getBoundingClientRect();
      const bx = (r.left - pageRect.left) * mmPerPx;
      const by = (r.top - pageRect.top) * mmPerPx;
      const bw = r.width * mmPerPx;
      const bh = r.height * mmPerPx;
      const label = "Pay via UPI \u00BB";
      const fontSizePt = 12;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(fontSizePt);
      pdf.setTextColor(255, 255, 255);
      const tw = pdf.getTextWidth(label);
      pdf.text(label, bx + (bw - tw) / 2, by + bh / 2 + fontSizePt * 0.35 * 0.352778);
      pdf.link(bx, by, bw, bh, { url: upiUrl });
    }

    // Clickable payment link — a real PDF link annotation over the QR.
    // Viewers that hand custom URI schemes to the OS open the customer's UPI
    // app with the amount prefilled.
    if (upiUrl) {
      const el = holder.querySelector<HTMLElement>(".qr-img");
      if (el) {
        const mmPerPx = pageWidthMm / pageEl.offsetWidth;
        const pageRect = pageEl.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        pdf.link(
          (r.left - pageRect.left) * mmPerPx,
          (r.top - pageRect.top) * mmPerPx,
          r.width * mmPerPx,
          r.height * mmPerPx,
          { url: upiUrl },
        );
      }
    }

    const safeNum = (input.invoiceNumber || "invoice").replace(/[^\w-]/g, "_");
    const filename = `DRAEP-Invoice-${safeNum}.pdf`;
    const blob = pdf.output("blob");
    saveAs(blob, filename);
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}
