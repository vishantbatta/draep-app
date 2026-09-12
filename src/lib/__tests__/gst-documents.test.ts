/**
 * GST document renderer tests — the frozen-document contract (FE-2).
 *
 * Everything shown on a minted invoice / credit note must come from the
 * API payload (seller GSTIN, SAC, rate, amounts in paise, dates) — the
 * renderer recomputes nothing and hardcodes nothing. These are the pure
 * string builders; the PDF raster is the same html2canvas pipeline the
 * legacy invoice already uses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildGstCreditNoteHtml,
  buildGstInvoiceHtml,
  paiseToAmountString,
  paiseToRupeeString,
  type GstCreditNote,
  type GstInvoice,
} from "@/lib/gst-documents";

// ─── Fixtures — one IGST invoice and one CGST/SGST invoice ───────────────────

const SELLER = {
  name: "Draep Technologies Pvt. Ltd.",
  gstin: "09AAMCD3592M1ZX",
  address: "1 Test Lane, Noida, Uttar Pradesh",
  state: "Uttar Pradesh",
  sac: "998822",
};

function igstInvoice(overrides: Partial<GstInvoice> = {}): GstInvoice {
  return {
    id: "inv-1",
    kind: "invoice",
    number: "INV/2627/000001",
    fy: "2627",
    issueTs: "2026-09-10T10:30:00+05:30",
    dateIst: "10 Sep 2026",
    orderId: "o1",
    orderNumber: "12333",
    transactionId: "t1",
    seller: SELLER,
    buyer: { name: "Riya Sharma", address: "2B Ashoka Lane\nLucknow 226001", gstin: null },
    placeOfSupply: "Uttar Pradesh (09)",
    taxKind: "igst",
    amounts: {
      totalPaise: 300000,
      taxablePaise: 285714,
      taxPaise: 14286,
      cgstPaise: 0,
      sgstPaise: 0,
      rateBp: 500,
      reversedPaise: 0,
      netPaise: 300000,
    },
    totalInWords: "Rupees three thousand only",
    description: "Custom garment stitching services (SAC 998822) — order 12333",
    paymentRef: "manual:cash",
    paymentReceivedNote: "Cash at visit",
    voided: false,
    voidReason: null,
    ...overrides,
  };
}

function cgstInvoice(): GstInvoice {
  return igstInvoice({
    number: "INV/2627/000002",
    taxKind: "cgst_sgst",
    placeOfSupply: "Uttar Pradesh (09)",
    amounts: {
      totalPaise: 5000,
      taxablePaise: 4762,
      taxPaise: 238,
      cgstPaise: 119,
      sgstPaise: 119,
      rateBp: 500,
      reversedPaise: 0,
      netPaise: 5000,
    },
    totalInWords: "Rupees fifty only",
  });
}

function creditNote(): GstCreditNote {
  return {
    id: "cn-1",
    kind: "credit_note",
    number: "CN/2627/000001",
    fy: "2627",
    issueTs: "2026-09-10T12:00:00+05:30",
    dateIst: "10 Sep 2026",
    orderId: "o1",
    orderNumber: "12333",
    transactionId: "t2",
    invoiceId: "inv-1",
    invoiceNumber: "INV/2627/000001",
    amountPaise: 200000,
    amountInWords: "Rupees two thousand only",
    reason: "refund",
    note: "Customer returned one garment",
  };
}

// ─── Money formatting ────────────────────────────────────────────────────────

describe("paise formatting", () => {
  it("paise → rupee string with Indian grouping and 2 decimals", () => {
    expect(paiseToRupeeString(300000)).toBe("₹3,000.00");
    expect(paiseToRupeeString(5000)).toBe("₹50.00");
    expect(paiseToRupeeString(95)).toBe("₹0.95");
    expect(paiseToRupeeString(123450000)).toBe("₹12,34,500.00");
  });

  it("null / undefined → zero, negatives wrapped like ledgers do", () => {
    expect(paiseToRupeeString(null)).toBe("₹0.00");
    expect(paiseToAmountString(undefined)).toBe("0.00");
  });
});

// ─── Invoice rendering (F2.2) ────────────────────────────────────────────────

describe("buildGstInvoiceHtml", () => {
  const html = buildGstInvoiceHtml(igstInvoice());

  it("prints number, IST date, order number, description line", () => {
    expect(html).toContain("INV/2627/000001");
    expect(html).toContain("10 Sep 2026");
    expect(html).toContain("#12333");
    expect(html).toContain("Custom garment stitching services (SAC 998822)");
  });

  it("seller GSTIN / SAC / state come from the payload, not constants", () => {
    expect(html).toContain("09AAMCD3592M1ZX");
    expect(html).toContain("998822");
    expect(html).toContain("Uttar Pradesh");
  });

  it("IGST invoice renders one IGST row and no CGST/SGST rows", () => {
    expect(html).toContain("IGST (5%)");
    expect(html).not.toContain("CGST");
    expect(html).not.toContain("SGST");
    expect(html).toContain("2,857.14");
    expect(html).toContain("142.86");
  });

  it("CGST/SGST invoice renders both split rows (F2.2)", () => {
    const h = buildGstInvoiceHtml(cgstInvoice());
    expect(h).toContain("CGST");
    expect(h).toContain("SGST");
    expect(h).toContain("1.19");
    expect(h).not.toMatch(/IGST \(/);
  });

  it("amounts in words and payment reference render", () => {
    expect(html).toContain("Rupees three thousand only");
    expect(html).toContain("manual:cash");
  });

  it("reversed invoice shows the reversal + net rows (F1.3 data)", () => {
    const h = buildGstInvoiceHtml(
      igstInvoice({
        amounts: {
          totalPaise: 300000,
          taxablePaise: 285714,
          taxPaise: 14286,
          cgstPaise: 0,
          sgstPaise: 0,
          rateBp: 500,
          reversedPaise: 100000,
          netPaise: 200000,
        },
      }),
    );
    expect(h).toContain("Reversed");
    expect(h).toContain("2,000.00"); // net
    expect(h).toContain("1,000.00"); // reversed
  });

  it("voided invoice carries the void band (never silently valid)", () => {
    const h = buildGstInvoiceHtml(igstInvoice({ voided: true, voidReason: "issued in error" }));
    expect(h).toContain("Void");
    expect(h).toContain("issued in error");
  });
});

// ─── Credit note rendering (F2.4) ────────────────────────────────────────────

describe("buildGstCreditNoteHtml", () => {
  const html = buildGstCreditNoteHtml(creditNote(), SELLER);

  it("heading, number, and the invoice it reverses", () => {
    expect(html).toContain("CREDIT NOTE");
    expect(html).toContain("CN/2627/000001");
    expect(html).toContain("INV/2627/000001");
  });

  it("negative-styled amount, reason line, words", () => {
    expect(html).toContain("− ₹2,000.00");
    expect(html).toContain("Reason: refund");
    expect(html).toContain("Rupees two thousand only");
  });
});

// ─── F2.3 — no hardcoded GST identity in the source ─────────────────────────

describe("gst-documents source has no hardcoded GST identity (F2.3)", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(
      join(process.cwd(), "src/lib/gst-documents.ts"),
      "utf-8",
    );
  });

  it("no GSTIN, no SAC, no rate constant baked in", () => {
    expect(source).not.toContain("09AAMCD");
    expect(source).not.toContain("998822");
    expect(source).not.toMatch(/GST_RATE\s*=/);
    expect(source).not.toMatch(/HSN_SAC\s*=/);
  });
});
