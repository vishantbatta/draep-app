"use client";

/**
 * Configure → Invoices: two horizontal sub-tabs.
 *
 * 1. "Generate invoice" — mint a standalone tax invoice (counter sale with no
 *    order/payment behind it). Same gapless INV/{FY} series as payment
 *    invoices; the issue date may be any day in the current financial year up
 *    to today IST. The preview mirrors the backend's integer-paise math, but
 *    the server response is the legal record and is what's shown on success.
 *    "History" opens every invoice minted through this flow, with PDF
 *    download and credit-note issuance (corrections are always credit notes).
 *
 * 2. "Missing documents" — every captured payment without an invoice and
 *    every confirmed refund without a credit note. Per-row generate,
 *    multi-select generate, and a master "generate all" (all dated TODAY —
 *    the law forbids backdating, so a belated mint carries today's date).
 * 3. "History" — every invoice and credit note from either flow (payment or
 *    manual), newest first, cross-linked: reversed invoices badge their
 *    credit notes, credit notes point back at the invoice they correct.
 *    Per-row PDF download and credit-note issuance.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  backfillLegacyDocuments,
  createManualCreditNote,
  createManualInvoice,
  listAllCreditNotes,
  listAllInvoices,
  listManualInvoices,
  type BackfillResult,
} from "@/lib/admin-api";
import {
  generateGstDocumentPdf,
  paiseToRupeeString,
  type GstCreditNote,
  type GstInvoice,
} from "@/lib/gst-documents";
import { Modal } from "../../catalogue/_shared/catalogue-helpers";

// ─── Sub-tabs for Configure (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
  { key: "serviceability", label: "Serviceability Areas", href: "/admin/actions/serviceability" },
  { key: "urls", label: "URLs", href: "/admin/actions/urls" },
  { key: "invoices", label: "Invoices", href: "/admin/actions/invoices" },
  { key: "promotions", label: "Promotions", href: "/admin/actions/promotions" },
  { key: "measurements", label: "Measurements", href: "/admin/measurements" },
  { key: "validation-rules", label: "Validation Rules", href: "/admin/catalogue/validation-rules" },
  { key: "sop-video", label: "SOP Video Generator", href: "/admin/actions/sop-video" },
] as const;

// ─── GST helpers (mirror be/app/core/invoice_math.py) ─────────────────────────

/** Mirrors settings.gst_seller_state on the backend ("UP" + aliases) — used
 *  ONLY for the live preview's CGST+SGST vs IGST split. The backend
 *  recomputes authoritatively at mint time; the success panel shows its
 *  numbers, not the preview's. */
const SELLER_STATE_ALIASES = new Set(["up", "uttar pradesh", "uttarpradesh", "u.p."]);

const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const RATE_OPTIONS = [
  { bp: 0, label: "0%" },
  { bp: 500, label: "5%" },
  { bp: 1200, label: "12%" },
  { bp: 1800, label: "18%" },
];

const GSTIN_RE = /^[0-9A-Z]{15}$/;

/** settings.gst_sac_code on the backend — the form prefills with it. */
const DEFAULT_SAC = "998822";

/** Printed on the invoice's Terms line; values are what the backend validates. */
const TERMS_OPTIONS = [
  { value: "paid_in_full", label: "Paid in Full" },
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "partially_paid", label: "Partially paid" },
];

/** "yyyy-mm-dd" for a wall-clock moment in IST (UTC+5:30). */
function istDateStr(d: Date): string {
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getFullYear()}-${pad(ist.getMonth() + 1)}-${pad(ist.getDate())}`;
}

/** First day of the current financial year (1 April) in IST. */
function fyStartIst(): string {
  const ist = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60_000);
  const april = ist.getMonth() >= 3 ? ist.getFullYear() : ist.getFullYear() - 1;
  return `${april}-04-01`;
}

/** Exact mirror of the backend's integer-paise back-calculation. */
function computeTotals(rupees: number, rateBp: number) {
  const total = rupees * 100;
  const denom = 10_000 + rateBp;
  const taxable = Math.floor((total * 10_000 + Math.floor(denom / 2)) / denom);
  const tax = total - taxable;
  const cgst = Math.floor(tax / 2);
  return { total, taxable, tax, cgst, sgst: tax - cgst };
}

function taxKindFor(state: string): "cgst_sgst" | "igst" | null {
  const norm = state.trim().toLowerCase();
  if (!norm) return null;
  return SELLER_STATE_ALIASES.has(norm) ? "cgst_sgst" : "igst";
}

const formatRupees = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;

// ─── Page ─────────────────────────────────────────────────────────────────────

type SubTab = "manual" | "missing" | "history";

interface FormState {
  buyerName: string;
  buyerState: string;
  buyerGstin: string;
  buyerAddress: string;
  itemDescription: string;
  amountRupees: string;
  rateBp: number;
  sacCode: string;
  /** paid_in_full | due_on_receipt | partially_paid — see TERMS_OPTIONS. */
  paymentTerms: string;
  issueDate: string;
  note: string;
}

type MissingItem = BackfillResult["items"][number];

export default function InvoicesActionPage() {
  const router = useRouter();
  const [tab, setTab] = useState<SubTab>("manual");

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: t.key === "invoices",
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-semibold text-ink-navy">Invoices</h1>
        <p className="mt-1 text-sm text-muted">
          Manual tax invoices for counter sales, and repair for payments missing their documents.
        </p>
      </div>

      {/* Horizontal sub-tab switch */}
      <div className="mb-6 inline-flex rounded-pill border border-hairline bg-chalk-white p-1">
        <button
          onClick={() => setTab("manual")}
          className={`rounded-pill px-4 py-1.5 text-caption font-medium transition ${
            tab === "manual" ? "bg-ink-navy text-chalk-white" : "text-muted hover:text-ink"
          }`}
        >
          Generate invoice
        </button>
        <button
          onClick={() => setTab("missing")}
          className={`rounded-pill px-4 py-1.5 text-caption font-medium transition ${
            tab === "missing" ? "bg-ink-navy text-chalk-white" : "text-muted hover:text-ink"
          }`}
        >
          Missing documents
        </button>
        <button
          onClick={() => setTab("history")}
          className={`rounded-pill px-4 py-1.5 text-caption font-medium transition ${
            tab === "history" ? "bg-ink-navy text-chalk-white" : "text-muted hover:text-ink"
          }`}
        >
          History
        </button>
      </div>

      {tab === "manual" ? (
        <ManualInvoiceTab />
      ) : tab === "missing" ? (
        <MissingDocumentsTab />
      ) : (
        <InvoicesHistoryTab />
      )}
    </div>
  );
}

// ─── Sub-tab 1: manual invoice form ───────────────────────────────────────────

function ManualInvoiceTab() {
  const today = istDateStr(new Date());
  const fyStart = fyStartIst();

  const [form, setForm] = useState<FormState>({
    buyerName: "",
    buyerState: "",
    buyerGstin: "",
    buyerAddress: "",
    itemDescription: "",
    amountRupees: "",
    rateBp: 500,
    sacCode: DEFAULT_SAC,
    paymentTerms: "paid_in_full",
    issueDate: today,
    note: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<GstInvoice | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const inputCls =
    "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";
  const labelCls = "mb-1 block text-xs font-medium text-muted";

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const amount = Number.parseInt(form.amountRupees, 10);
  const amountValid =
    Number.isInteger(amount) && form.amountRupees.trim() !== "" && amount >= 1 && amount <= 10_000_000;

  const preview = useMemo(
    () => (amountValid ? computeTotals(amount, form.rateBp) : null),
    [amountValid, amount, form.rateBp],
  );
  const previewKind = taxKindFor(form.buyerState);

  function validate(): string | null {
    if (!form.buyerName.trim()) return "Buyer name is required.";
    if (!form.buyerState) return "Select the buyer's state — it is the place of supply and decides IGST vs CGST+SGST.";
    if (!form.itemDescription.trim()) return "Item description is required.";
    if (!amountValid) return "Amount must be a whole number of rupees between 1 and 1,00,00,000.";
    const gstin = form.buyerGstin.trim().toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) return "GSTIN must be exactly 15 characters (digits and capital letters).";
    const sac = form.sacCode.trim();
    if (sac && sac.length > 16) return "SAC/HSN code must be 1–16 characters, or empty.";
    if (!form.issueDate) return "Pick an issue date.";
    if (form.issueDate < fyStart || form.issueDate > today)
      return `Issue date must be within the current financial year (${fyStart} to ${today}).`;
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const inv = await createManualInvoice({
        buyer_name: form.buyerName.trim(),
        buyer_state: form.buyerState,
        item_description: form.itemDescription.trim(),
        total_rupees: amount,
        buyer_address: form.buyerAddress.trim() || null,
        buyer_gstin: form.buyerGstin.trim().toUpperCase() || null,
        rate_bp: form.rateBp,
        sac_code: form.sacCode.trim() || null,
        payment_terms: form.paymentTerms,
        note: form.note.trim() || null,
        issue_date: form.issueDate || null,
      });
      setCreated(inv);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDownload() {
    if (!created) return;
    setDownloading(true);
    try {
      await generateGstDocumentPdf(created); // payload carries its own seller
    } catch {
      // generateGstDocumentPdf surfaces its own progress; keep the button quiet
    } finally {
      setDownloading(false);
    }
  }

  function resetForm() {
    setCreated(null);
    setFormError(null);
    setForm({
      buyerName: "",
      buyerState: "",
      buyerGstin: "",
      buyerAddress: "",
      itemDescription: "",
      amountRupees: "",
      rateBp: 500,
      sacCode: DEFAULT_SAC,
      paymentTerms: "paid_in_full",
      issueDate: istDateStr(new Date()),
      note: "",
    });
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex justify-end">
        <button
          onClick={() => setHistoryOpen(true)}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40"
        >
          🕘 History
        </button>
      </div>

      {/* Success panel — server numbers are the legal record */}
      {created && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-green-900">
                Tax invoice {created.number} issued — {created.dateIst}
              </div>
              <div className="mt-1 text-xs text-green-800">
                Taxable {paiseToRupeeString(created.amounts.taxablePaise)} · GST{" "}
                {paiseToRupeeString(created.amounts.taxPaise)} (
                {created.taxKind === "igst"
                  ? `IGST ${paiseToRupeeString(created.amounts.taxPaise)}`
                  : `CGST ${paiseToRupeeString(created.amounts.cgstPaise)} + SGST ${paiseToRupeeString(created.amounts.sgstPaise)}`}
                ) · Total {paiseToRupeeString(created.amounts.totalPaise)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {downloading ? "Preparing…" : "⬇ PDF"}
              </button>
              <button
                onClick={resetForm}
                className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-semibold text-green-800 transition hover:bg-green-100"
              >
                Create another
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* ── Form ── */}
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-hairline bg-chalk-white p-4 md:p-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelCls}>Buyer name *</label>
              <input
                className={inputCls}
                value={form.buyerName}
                onChange={(e) => patch("buyerName", e.target.value)}
                placeholder="Meera Kapoor"
              />
            </div>
            <div>
              <label className={labelCls}>Buyer state (place of supply) *</label>
              <select
                className={inputCls}
                value={form.buyerState}
                onChange={(e) => patch("buyerState", e.target.value)}
              >
                <option value="">Select state…</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Buyer GSTIN (optional)</label>
              <input
                className={`${inputCls} font-mono uppercase`}
                value={form.buyerGstin}
                onChange={(e) => patch("buyerGstin", e.target.value.toUpperCase())}
                placeholder="15 characters"
                maxLength={15}
              />
            </div>
            <div>
              <label className={labelCls}>Issue date *</label>
              <input
                type="date"
                className={inputCls}
                value={form.issueDate}
                min={fyStart}
                max={today}
                onChange={(e) => patch("issueDate", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>Buyer address (optional)</label>
            <textarea
              className={`${inputCls} min-h-[64px] rounded-lg`}
              value={form.buyerAddress}
              onChange={(e) => patch("buyerAddress", e.target.value)}
              placeholder="Street, city, PIN"
            />
          </div>

          <div>
            <label className={labelCls}>Item description *</label>
            <input
              className={inputCls}
              value={form.itemDescription}
              onChange={(e) => patch("itemDescription", e.target.value)}
              placeholder="Fabric sale — silk 2m"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className={labelCls}>Amount (₹, tax-inclusive) *</label>
              <input
                type="number"
                min={1}
                step={1}
                className={inputCls}
                value={form.amountRupees}
                onChange={(e) => patch("amountRupees", e.target.value)}
                placeholder="2100"
              />
            </div>
            <div>
              <label className={labelCls}>GST rate *</label>
              <select
                className={inputCls}
                value={form.rateBp}
                onChange={(e) => patch("rateBp", Number(e.target.value))}
              >
                {RATE_OPTIONS.map((r) => (
                  <option key={r.bp} value={r.bp}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>SAC / HSN code</label>
              <input
                className={`${inputCls} font-mono`}
                value={form.sacCode}
                onChange={(e) => patch("sacCode", e.target.value)}
                placeholder={DEFAULT_SAC}
                maxLength={16}
              />
              <span className="mt-1 block text-[11px] text-muted">
                Prefilled with the default ({DEFAULT_SAC}); empty also uses it.
              </span>
            </div>
            <div>
              <label className={labelCls}>Terms *</label>
              <select
                className={inputCls}
                value={form.paymentTerms}
                onChange={(e) => patch("paymentTerms", e.target.value)}
              >
                {TERMS_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-muted">
                Printed on the invoice&apos;s Terms line.
              </span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Payment note (optional)</label>
            <input
              className={inputCls}
              value={form.note}
              onChange={(e) => patch("note", e.target.value)}
              placeholder="Received in cash"
            />
          </div>

          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Minting…" : "Generate invoice"}
            </button>
            <span className="text-[11px] text-muted">
              Shares the gapless INV/FY series · immutable once issued
            </span>
          </div>
        </form>

        {/* ── Live totals preview ── */}
        <aside className="h-fit rounded-xl border border-hairline bg-chalk-white p-4 lg:sticky lg:top-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Totals preview
          </div>
          {preview ? (
            <div className="mt-3 space-y-2 text-sm">
              <Row label="Taxable value" value={paiseToRupeeString(preview.taxable)} />
              <Row
                label={
                  previewKind === "igst"
                    ? `IGST @ ${(form.rateBp / 100).toFixed(0)}%`
                    : previewKind === "cgst_sgst"
                      ? `CGST + SGST @ ${(form.rateBp / 100).toFixed(0)}%`
                      : "GST"
                }
                value={paiseToRupeeString(preview.tax)}
              />
              {previewKind === "cgst_sgst" && (
                <div className="pl-3 text-[11px] text-muted">
                  CGST {paiseToRupeeString(preview.cgst)} + SGST {paiseToRupeeString(preview.sgst)}
                </div>
              )}
              <div className="border-t border-hairline pt-2">
                <Row label="Total (tax-inclusive)" value={paiseToRupeeString(preview.total)} strong />
              </div>
              <p className="pt-1 text-[11px] leading-snug text-muted">
                {previewKind
                  ? "Preview only — the backend recomputes and its numbers are the legal record."
                  : "Select the buyer's state to see the CGST+SGST / IGST split."}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted">
              Enter an amount to see the tax back-calculation. The entered amount is the
              tax-inclusive total.
            </p>
          )}
        </aside>
      </div>

      <ManualHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? "text-sm font-semibold text-ink" : "text-muted"}>{label}</span>
      <span className={`font-mono text-[13px] ${strong ? "font-semibold text-ink" : "text-ink"}`}>
        {value}
      </span>
    </div>
  );
}

// ─── History modal: invoices minted through the manual flow ───────────────────

function ManualHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [invoices, setInvoices] = useState<GstInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Credit-note inline form (one row open at a time)
  const [cnOpenId, setCnOpenId] = useState<string | null>(null);
  const [cnAmount, setCnAmount] = useState("");
  const [cnNote, setCnNote] = useState("");
  const [cnBusy, setCnBusy] = useState(false);
  const [cnError, setCnError] = useState<string | null>(null);
  const [cnDone, setCnDone] = useState<string | null>(null); // "CN/2627/000001 · ₹500"

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvoices(await listManualInvoices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invoice history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setCnOpenId(null);
      setCnDone(null);
      setCnError(null);
      load();
    }
  }, [open, load]);

  function openCnForm(inv: GstInvoice) {
    setCnOpenId(inv.id);
    setCnAmount("");
    setCnNote("");
    setCnError(null);
    setCnDone(null);
  }

  async function submitCreditNote(inv: GstInvoice) {
    const amount = Number.parseInt(cnAmount, 10);
    const netRupees = Math.floor((inv.amounts.netPaise ?? 0) / 100);
    if (!Number.isInteger(amount) || amount < 1 || amount > netRupees) {
      setCnError(`Amount must be a whole number of rupees between 1 and ${netRupees.toLocaleString("en-IN")} (the unreversed balance).`);
      return;
    }
    setCnBusy(true);
    setCnError(null);
    try {
      const cn = await createManualCreditNote(inv.id, {
        amount_rupees: amount,
        note: cnNote.trim() || null,
      });
      setCnDone(`${cn.number} · ₹${amount.toLocaleString("en-IN")}`);
      await load(); // row now shows the new reversed/net split
    } catch (e) {
      setCnError(e instanceof Error ? e.message : "Failed to issue credit note");
    } finally {
      setCnBusy(false);
    }
  }

  return (
    <Modal open={open} title="Manual invoice history" onClose={onClose} maxWidth="max-w-6xl">
      <div className="px-5 py-4">
        <p className="mb-3 text-xs text-muted">
          Invoices issued through this flow (newest first). Corrections are always credit notes —
          invoices are never edited.
        </p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {loading && invoices.length === 0 ? (
          <div className="space-y-2 py-4">
            <div className="h-4 w-1/4 animate-pulse rounded bg-mist-navy/60" />
            <div className="h-8 w-full animate-pulse rounded bg-mist-navy/40" />
            <div className="h-8 w-full animate-pulse rounded bg-mist-navy/40" />
          </div>
        ) : invoices.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            No manual invoices yet — the first one you generate will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Buyer</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Taxable</th>
                  <th className="px-3 py-2 text-right font-medium">GST</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Reversed / Net</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const fullyReversed = (inv.amounts.reversedPaise ?? 0) >= (inv.amounts.totalPaise ?? 0);
                  return (
                    <tr key={inv.id} className="border-b border-hairline align-top last:border-0">
                      <td className="px-3 py-2 font-mono text-[12px] text-ink">{inv.number}</td>
                      <td className="px-3 py-2 text-[12px] text-muted">{inv.dateIst}</td>
                      <td className="px-3 py-2 text-[13px] text-ink">
                        {inv.buyer.name}
                        <div className="text-[11px] text-muted">{inv.placeOfSupply}</div>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-[12px] text-ink" title={inv.description ?? undefined}>
                        {inv.description ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[12px] text-ink">
                        {paiseToRupeeString(inv.amounts.taxablePaise)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[12px] text-ink">
                        {paiseToRupeeString(inv.amounts.taxPaise)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] font-semibold text-ink">
                        {paiseToRupeeString(inv.amounts.totalPaise)}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        {(inv.amounts.reversedPaise ?? 0) > 0 ? (
                          <>
                            <span className="rounded-pill bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">
                              {paiseToRupeeString(inv.amounts.reversedPaise)} reversed
                            </span>
                            <div className="mt-1 text-muted">
                              Net {paiseToRupeeString(inv.amounts.netPaise)}
                            </div>
                          </>
                        ) : (
                          <span className="rounded-pill bg-green-50 px-1.5 py-0.5 font-medium text-green-700">
                            Net {paiseToRupeeString(inv.amounts.netPaise)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => generateGstDocumentPdf(inv)}
                            title="Download tax invoice PDF"
                            className="rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-mist-navy/40"
                          >
                            ⬇ PDF
                          </button>
                          {!fullyReversed ? (
                            <button
                              onClick={() => (cnOpenId === inv.id ? setCnOpenId(null) : openCnForm(inv))}
                              className="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 transition hover:bg-purple-100"
                            >
                              Credit note
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted" title="Fully reversed">
                              —
                            </span>
                          )}
                        </div>

                        {/* Inline credit-note form */}
                        {cnOpenId === inv.id && (
                          <div className="mt-2 space-y-1.5 rounded-lg border border-purple-200 bg-purple-50/60 p-2 text-left">
                            {cnDone ? (
                              <div className="text-[11px] font-medium text-green-800">
                                Credit note issued — {cnDone}
                              </div>
                            ) : (
                              <>
                                <div className="flex gap-1.5">
                                  <input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={cnAmount}
                                    onChange={(e) => setCnAmount(e.target.value)}
                                    placeholder={`₹ (1–${Math.floor((inv.amounts.netPaise ?? 0) / 100).toLocaleString("en-IN")})`}
                                    className="w-32 rounded-pill border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-accent-text"
                                  />
                                  <input
                                    value={cnNote}
                                    onChange={(e) => setCnNote(e.target.value)}
                                    placeholder="Note (optional)"
                                    className="flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-accent-text"
                                  />
                                </div>
                                {cnError && <div className="text-[11px] text-red-700">{cnError}</div>}
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => submitCreditNote(inv)}
                                    disabled={cnBusy}
                                    className="rounded-md bg-purple-700 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {cnBusy ? "Issuing…" : `Issue credit note · dated today`}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Sub-tab 2: payments missing their documents ──────────────────────────────

type Busy = "all" | "selected" | string | null; // string = orderId

function MissingDocumentsTab() {
  const [items, setItems] = useState<MissingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // transactionIds
  const [busy, setBusy] = useState<Busy>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backfillLegacyDocuments(undefined, true);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load missing documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedOrderIds = useMemo(
    () =>
      [...new Set(items.filter((i) => i.transactionId && selected.has(i.transactionId)).map((i) => i.orderId).filter(Boolean) as string[])],
    [items, selected],
  );

  function toggle(txnId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
  }

  const allChecked = items.length > 0 && items.every((i) => i.transactionId && selected.has(i.transactionId));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(items.map((i) => i.transactionId).filter(Boolean) as string[]));
  }

  /** Real (non-dry) backfill; shows what was minted and refreshes the list. */
  async function run(orderIds: string[] | null, kind: Busy) {
    setBusy(kind);
    setError(null);
    setResultMsg(null);
    try {
      const res = await backfillLegacyDocuments(orderIds ?? undefined, false);
      const numbers = res.items
        .flatMap((i) => (Array.isArray(i.minted) ? i.minted : i.minted ? [i.minted] : []))
        .map((m) => m.number);
      setResultMsg(
        res.invoiceCount + res.creditNoteCount > 0
          ? `Minted ${res.invoiceCount} invoice(s) and ${res.creditNoteCount} credit note(s), dated today${numbers.length ? `: ${numbers.join(", ")}` : ""}.`
          : "Nothing was missing — the books already match the ledger.",
      );
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  }

  function handleAll() {
    if (
      window.confirm(
        `Mint all ${items.length} missing document(s) dated today?\nThis issues real tax invoices / credit notes and cannot be undone.`,
      )
    ) {
      run(null, "all");
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          {selectedOrderIds.length > 0 && (
            <button
              onClick={() => run(selectedOrderIds, "selected")}
              disabled={busy !== null}
              className="rounded-md bg-ink-navy px-3 py-1.5 text-xs font-semibold text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "selected" ? "Generating…" : `Generate selected (${selectedOrderIds.length} order${selectedOrderIds.length > 1 ? "s" : ""})`}
            </button>
          )}
        </div>
        {items.length > 0 && (
          <button
            onClick={handleAll}
            disabled={busy !== null}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "all" ? "Generating all…" : "Generate all invoices"}
          </button>
        )}
      </div>

      {resultMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-xs text-green-800">
          {resultMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="animate-pulse space-y-2 rounded-xl border border-hairline bg-chalk-white p-4">
          <div className="h-4 w-1/4 rounded bg-mist-navy/60" />
          <div className="h-8 w-full rounded bg-mist-navy/40" />
          <div className="h-8 w-full rounded bg-mist-navy/40" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-chalk-white px-4 py-8 text-center">
          <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-mist-navy/60 text-sm">
            ✅
          </div>
          <p className="text-sm text-muted">
            All caught up — every captured payment and confirmed refund has its document.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-chalk-white">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all"
                    className="h-3.5 w-3.5 accent-ink-navy"
                  />
                </th>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Transaction</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Missing</th>
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const txnId = item.transactionId ?? "";
                const checked = txnId !== "" && selected.has(txnId);
                const isInvoice = item.wouldMint !== "credit_note";
                return (
                  <tr key={txnId || item.orderId} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(txnId)}
                        disabled={!txnId}
                        aria-label="Select row"
                        className="h-3.5 w-3.5 accent-ink-navy"
                      />
                    </td>
                    <td className="px-4 py-2">
                      {item.orderId ? (
                        <Link
                          href={`/admin/orders/${item.orderId}`}
                          className="font-mono text-[12px] text-accent-text underline-offset-2 hover:underline"
                        >
                          {item.orderNumber ?? item.orderId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[13px] text-ink">
                      {item.customerName ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2 text-[12px] text-muted">{item.dateIst ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-muted">
                      {txnId ? txnId.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[13px] text-ink">
                      {formatRupees(item.amountRupees)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${
                          isInvoice ? "bg-green-50 text-green-700" : "bg-purple-50 text-purple-700"
                        }`}
                      >
                        {isInvoice ? "Tax Invoice" : "Credit Note"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => item.orderId && run([item.orderId], item.orderId)}
                        disabled={busy !== null}
                        title="Issue every document this order is missing, dated today"
                        className="rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy === item.orderId ? "…" : "Generate"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted">
        Money moved without a document. Generating issues it dated <strong>today</strong> — the law
        forbids backdating, regardless of when the payment happened.
      </p>
    </div>
  );
}

// ─── Sub-tab 3: full document history (invoices + credit notes) ───────────────

type HistoryDoc = GstInvoice | GstCreditNote;

function InvoicesHistoryTab() {
  const [invoices, setInvoices] = useState<GstInvoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<GstCreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null); // doc id

  // Credit-note inline form (one row open at a time)
  const [cnOpenId, setCnOpenId] = useState<string | null>(null);
  const [cnAmount, setCnAmount] = useState("");
  const [cnNote, setCnNote] = useState("");
  const [cnBusy, setCnBusy] = useState(false);
  const [cnError, setCnError] = useState<string | null>(null);
  const [cnDone, setCnDone] = useState<string | null>(null); // "CN/2627/000001 · ₹500"

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, cns] = await Promise.all([listAllInvoices(), listAllCreditNotes()]);
      setInvoices(inv);
      setCreditNotes(cns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load document history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Unified timeline, newest first.
  const docs = useMemo<HistoryDoc[]>(
    () =>
      [...invoices, ...creditNotes].sort(
        (a, b) =>
          (b.issueTs ?? "").localeCompare(a.issueTs ?? "") ||
          (b.number ?? "").localeCompare(a.number ?? ""),
      ),
    [invoices, creditNotes],
  );

  // Connections: CNs grouped by the invoice they reverse; invoices lookup for CN rows.
  const cnsByInvoice = useMemo(() => {
    const m = new Map<string, GstCreditNote[]>();
    for (const cn of creditNotes) {
      if (!cn.invoiceId) continue;
      m.set(cn.invoiceId, [...(m.get(cn.invoiceId) ?? []), cn]);
    }
    return m;
  }, [creditNotes]);
  const invoiceById = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  function openCnForm(inv: GstInvoice) {
    setCnOpenId(inv.id);
    setCnAmount("");
    setCnNote("");
    setCnError(null);
    setCnDone(null);
  }

  async function submitCreditNote(inv: GstInvoice) {
    const amount = Number.parseInt(cnAmount, 10);
    const netRupees = Math.floor((inv.amounts.netPaise ?? 0) / 100);
    if (!Number.isInteger(amount) || amount < 1 || amount > netRupees) {
      setCnError(
        `Amount must be a whole number of rupees between 1 and ${netRupees.toLocaleString(
          "en-IN",
        )} (the unreversed balance).`,
      );
      return;
    }
    setCnBusy(true);
    setCnError(null);
    try {
      const cn = await createManualCreditNote(inv.id, {
        amount_rupees: amount,
        note: cnNote.trim() || null,
      });
      setCnDone(`${cn.number} · ₹${amount.toLocaleString("en-IN")}`);
      await load(); // invoice row now shows the reversed/net split + the new CN badge
    } catch (e) {
      setCnError(e instanceof Error ? e.message : "Failed to issue credit note");
    } finally {
      setCnBusy(false);
    }
  }

  async function download(doc: HistoryDoc) {
    setDownloading(doc.id);
    try {
      await generateGstDocumentPdf(doc);
    } catch {
      // generateGstDocumentPdf surfaces its own progress; keep the button quiet
    } finally {
      setDownloading(null);
    }
  }

  const totalReversed = invoices.reduce((sum, i) => sum + (i.amounts.reversedPaise ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Every invoice and credit note from either flow, newest first. Reversed invoices link
          to their credit notes and back — corrections are always credit notes, never edits.
        </p>
        <button
          onClick={load}
          className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-mist-navy/40"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div className="space-y-2 py-4">
          <div className="h-4 w-1/4 animate-pulse rounded bg-mist-navy/60" />
          <div className="h-8 w-full animate-pulse rounded bg-mist-navy/40" />
          <div className="h-8 w-full animate-pulse rounded bg-mist-navy/40" />
        </div>
      ) : docs.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          No documents yet — they appear here the moment one is generated.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/40 text-xs uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Terms / Reason</th>
                  <th className="px-3 py-2 text-right font-medium">Taxable</th>
                  <th className="px-3 py-2 text-right font-medium">GST</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Reversals / Net</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) =>
                  doc.kind === "invoice" ? (
                    <InvoiceHistoryRow
                      key={doc.id}
                      inv={doc}
                      cnNumbers={cnsByInvoice.get(doc.id) ?? []}
                      cnOpen={cnOpenId === doc.id}
                      cnBusy={cnBusy}
                      cnError={cnError}
                      cnDone={cnDone}
                      cnAmount={cnAmount}
                      cnNote={cnNote}
                      downloading={downloading === doc.id}
                      onToggleCn={() => (cnOpenId === doc.id ? setCnOpenId(null) : openCnForm(doc))}
                      onCnAmount={setCnAmount}
                      onCnNote={setCnNote}
                      onSubmitCn={() => submitCreditNote(doc)}
                      onDownload={() => download(doc)}
                    />
                  ) : (
                    <CreditNoteHistoryRow
                      key={doc.id}
                      cn={doc}
                      buyerName={invoiceById.get(doc.invoiceId ?? "")?.buyer.name ?? null}
                      buyerPlace={invoiceById.get(doc.invoiceId ?? "")?.placeOfSupply ?? null}
                      downloading={downloading === doc.id}
                      onDownload={() => download(doc)}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">
            {invoices.length} invoice{invoices.length === 1 ? "" : "s"} · {creditNotes.length} credit
            note{creditNotes.length === 1 ? "" : "s"}
            {totalReversed > 0
              ? ` · ${paiseToRupeeString(totalReversed)} reversed via credit notes`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}

function InvoiceHistoryRow({
  inv,
  cnNumbers,
  cnOpen,
  cnBusy,
  cnError,
  cnDone,
  cnAmount,
  cnNote,
  downloading,
  onToggleCn,
  onCnAmount,
  onCnNote,
  onSubmitCn,
  onDownload,
}: {
  inv: GstInvoice;
  cnNumbers: GstCreditNote[];
  cnOpen: boolean;
  cnBusy: boolean;
  cnError: string | null;
  cnDone: string | null;
  cnAmount: string;
  cnNote: string;
  downloading: boolean;
  onToggleCn: () => void;
  onCnAmount: (v: string) => void;
  onCnNote: (v: string) => void;
  onSubmitCn: () => void;
  onDownload: () => void;
}) {
  const isManual = !inv.orderId && !inv.transactionId;
  const fullyReversed = (inv.amounts.reversedPaise ?? 0) >= (inv.amounts.totalPaise ?? 0);

  return (
    <tr id={`doc-${inv.id}`} className="border-b border-hairline align-top last:border-0">
      <td className="px-3 py-2 font-mono text-[12px] font-medium text-ink">{inv.number}</td>
      <td className="px-3 py-2 text-[12px] text-muted">{inv.dateIst}</td>
      <td className="px-3 py-2 text-[13px] text-ink">
        {inv.buyer.name ?? "—"}
        <div className="text-[11px] text-muted">{inv.placeOfSupply}</div>
      </td>
      <td className="px-3 py-2 text-[12px]">
        {inv.orderId ? (
          <Link
            href={`/admin/orders/${inv.orderId}`}
            className="font-mono text-accent-text underline-offset-2 hover:underline"
          >
            #{inv.orderNumber}
          </Link>
        ) : (
          <span className="text-muted" title="Manual invoice — no order behind it">
            —
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px]">
        {isManual ? (
          <span className="rounded-pill bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
            Manual
          </span>
        ) : (
          <span className="rounded-pill bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
            Payment
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px] text-muted">{inv.paymentTerms ?? "—"}</td>
      <td className="px-3 py-2 text-right font-mono text-[12px] text-ink">
        {paiseToRupeeString(inv.amounts.taxablePaise)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[12px] text-ink">
        {paiseToRupeeString(inv.amounts.taxPaise)}
      </td>
      <td className="px-3 py-2 text-right font-mono text-[13px] font-semibold text-ink">
        {paiseToRupeeString(inv.amounts.totalPaise)}
      </td>
      <td className="px-3 py-2 text-[11px]">
        {(inv.amounts.reversedPaise ?? 0) > 0 ? (
          <>
            <span className="rounded-pill bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">
              {paiseToRupeeString(inv.amounts.reversedPaise)} reversed
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {cnNumbers.map((cn) => (
                <a
                  key={cn.id}
                  href={`#doc-${cn.id}`}
                  title={`Credit note ${cn.number} issued against this invoice`}
                  className="rounded-pill border border-purple-200 px-1.5 py-0.5 font-mono text-[10px] text-purple-700 transition hover:bg-purple-50"
                >
                  {cn.number}
                </a>
              ))}
            </div>
            <div className="mt-1 text-muted">Net {paiseToRupeeString(inv.amounts.netPaise)}</div>
          </>
        ) : (
          <span className="rounded-pill bg-green-50 px-1.5 py-0.5 font-medium text-green-700">
            Net {paiseToRupeeString(inv.amounts.netPaise)}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={onDownload}
            disabled={downloading}
            className="rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {downloading ? "…" : "⬇ PDF"}
          </button>
          {!fullyReversed ? (
            <button
              onClick={onToggleCn}
              className="rounded-md border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 transition hover:bg-purple-100"
            >
              Credit note
            </button>
          ) : (
            <span className="text-[11px] text-muted" title="Fully reversed">
              —
            </span>
          )}
        </div>

        {/* Inline credit-note form */}
        {cnOpen && (
          <div className="mt-2 space-y-1.5 rounded-lg border border-purple-200 bg-purple-50/60 p-2 text-left">
            {cnDone ? (
              <span className="text-[11px] font-medium text-green-700">
                ✓ Issued {cnDone}
              </span>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={cnAmount}
                    onChange={(e) => onCnAmount(e.target.value)}
                    placeholder="₹ amount"
                    className="w-24 rounded-pill border border-hairline-strong bg-chalk-white px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-accent-text"
                  />
                  <input
                    value={cnNote}
                    onChange={(e) => onCnNote(e.target.value)}
                    placeholder="Note (optional)"
                    className="min-w-0 flex-1 rounded-pill border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-accent-text"
                  />
                  <button
                    onClick={onSubmitCn}
                    disabled={cnBusy}
                    className="rounded-pill bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {cnBusy ? "…" : "Issue"}
                  </button>
                </div>
                {cnError && <div className="text-[11px] text-red-600">{cnError}</div>}
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function CreditNoteHistoryRow({
  cn,
  buyerName,
  buyerPlace,
  downloading,
  onDownload,
}: {
  cn: GstCreditNote;
  buyerName: string | null;
  buyerPlace: string | null;
  downloading: boolean;
  onDownload: () => void;
}) {
  return (
    <tr id={`doc-${cn.id}`} className="border-b border-hairline bg-purple-50/30 align-top last:border-0">
      <td className="px-3 py-2 font-mono text-[12px] font-medium text-purple-700">{cn.number}</td>
      <td className="px-3 py-2 text-[12px] text-muted">{cn.dateIst}</td>
      <td className="px-3 py-2 text-[13px] text-ink">
        {buyerName ?? "—"}
        <div className="text-[11px] text-muted">{buyerPlace}</div>
      </td>
      <td className="px-3 py-2 text-[12px]">
        {cn.orderId ? (
          <Link
            href={`/admin/orders/${cn.orderId}`}
            className="font-mono text-accent-text underline-offset-2 hover:underline"
          >
            #{cn.orderNumber}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-[11px]">
        <span className="rounded-pill bg-purple-100 px-1.5 py-0.5 font-medium text-purple-800">
          Credit note
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] text-muted">
        {cn.reason === "payment_recorded_in_error" ? "Recorded in error" : cn.reason ?? "—"}
      </td>
      <td className="px-3 py-2 text-right text-muted">—</td>
      <td className="px-3 py-2 text-right text-muted">—</td>
      <td className="px-3 py-2 text-right font-mono text-[13px] font-semibold text-purple-700">
        {paiseToRupeeString(cn.amountPaise)}
      </td>
      <td className="px-3 py-2 text-[11px]">
        {cn.invoiceId && cn.invoiceNumber ? (
          <span className="text-muted">
            Reverses{" "}
            <a
              href={`#doc-${cn.invoiceId}`}
              title="The invoice this credit note corrects"
              className="font-mono text-purple-700 underline-offset-2 hover:underline"
            >
              {cn.invoiceNumber}
            </a>
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="rounded-md border border-hairline px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-mist-navy/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {downloading ? "…" : "⬇ PDF"}
        </button>
      </td>
    </tr>
  );
}
