/**
 * Measurement Job PDF — downloadable report.
 *
 * Strategy: build the same print-quality HTML layout (multi-page A4 with
 * Unicode-safe fonts), render it off-screen in the live DOM, rasterize each
 * `.page` element with html2canvas, then assemble a real multi-page PDF with
 * jsPDF and trigger a direct file download via file-saver.
 *
 * Why this approach (not browser print dialog):
 *   - The user explicitly asked for an auto-downloading file, not a print
 *     dialog where they'd have to manually pick "Save as PDF."
 *   - jsPDF's text-mode Unicode support requires bundling a 1MB+ Devanagari/
 *     Kannada font — rasterizing HTML sidesteps that by letting the browser
 *     render the scripts natively.
 *   - html2canvas + jsPDF is the production-grade pattern for "downloadable
 *     PDF that looks like the page."
 *
 * Layout (multi-page, flowed with measured pagination):
 *   Page 1 — Cover: order, customer, job notes
 *   Then, per garment order — one section flowed over as many A4 pages as
 *   needed (numbered "GARMENT n: <name>"):
 *     2.1 Style selections (simple table: Titles | Selected | Descriptions)
 *     2.2 Design inspiration images (reference only — not to be copied as-is)
 *     2.3 Per-garment measurements table (image | titles | descriptions | value)
 *     2.4 Cloth & materials
 *   Then — the embedded tax invoice (reuses the invoice-pdf.ts template;
 *   see `JobPdfInput.invoice`), then the order-level body measurements:
 *   the job's BASE readings only (garment-scoped ones live in each
 *   garment's 2.3 table), rendered in the same table format as 2.3.
 */

import type {
  AddressRow,
  BodyMeasurementWithMetric,
  GarmentMeasurementGroup,
  GarmentOrderItemRow,
  GarmentOrderRow,
  MeasurementJobRow,
  OrderRow,
  UserRow,
} from "./admin-api";
import { publicAssetAbsoluteUrl, resolveAssetUrl } from "./admin-api";
import {
  buildInvoiceDocumentHtml,
  invoiceUpiUrl,
  type InvoiceInput,
} from "./invoice-pdf";

// Lazily imported inside downloadMeasurementJobPdf so the QR encoder never
// bloats the main bundle for callers that never build a PDF.
type QrLib = typeof import("qrcode");

// ─── Style selections (optional extension) ─────────────────────────────────

/**
 * Multilingual catalogue info for ONE design-selection item, resolved by the
 * caller from the live catalogue tree (fetchGarmentTree). Titles and
 * descriptions are keyed by language code ("en", "hi", "kn") — every language
 * present on the catalogue row is rendered on the card.
 */
export interface StyleItemDetail {
  /** The grouping entity (style component, or the add-on itself). */
  componentLabels: Record<string, string> | null;
  componentDescriptions: Record<string, string> | null;
  /** The specific choice (variation / variation_type / addon variation). */
  choiceLabels: Record<string, string> | null;
  choiceDescriptions: Record<string, string> | null;
}

/** A garment order paired with its design items, for the PDF style pages. */
export interface StyleSelectionGroup {
  garmentOrder: GarmentOrderRow;
  /** A display label for the garment (resolved by the caller). */
  garmentLabel: string;
  basePrice: number | null;
  items: GarmentOrderItemRow[];
  /**
   * Per-item multilingual catalogue details (titles + descriptions in every
   * language), aligned with `items` by index. Optional — when absent the
   * cards fall back to the immutable label snapshots stamped at checkout.
   */
  itemDetails?: StyleItemDetail[];
  /**
   * Optional customer-uploaded design-inspiration photos for this garment
   * order (mirrors GarmentOrderRow.assets_shared). When provided, a photo
   * grid is rendered at the top of the garment's Style Selections page.
   */
  assetsShared?: string[] | null;
}

// ─── PDF customization (section toggles) ──────────────────────────────────

/**
 * Which sections to include in the generated PDF. The cover page ALWAYS
 * renders (it's the title page). Each flag below controls one content
 * section. Defaults to all-true so an omitted/undefined `sections` produces
 * the same PDF as before this customization was added.
 *
 *   customerDetails    → enriches the Cover page (phone / email / address)
 *   measurementDetails → the per-garment measurement tables (2.3) AND the
 *                        order-level Body Measurements table (this job's
 *                        base readings, same table format as 2.3)
 *   designDetails      → the per-garment Style Selections table (2.1) and
 *                        Design Inspiration images (2.2)
 *   fabricDetails      → the per-garment Cloth & Materials section (2.4)
 *   invoice            → the embedded one-page tax invoice (invoice-pdf.ts
 *                        template — the same invoice the "Download Invoice
 *                        PDF" button produces)
 */
export interface PdfSectionOptions {
  customerDetails: boolean;
  measurementDetails: boolean;
  designDetails: boolean;
  fabricDetails: boolean;
  invoice: boolean;
}

/** All sections enabled — the default, matching pre-customization output. */
const ALL_SECTIONS: PdfSectionOptions = {
  customerDetails: true,
  measurementDetails: true,
  designDetails: true,
  fabricDetails: true,
  invoice: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * HTML-escape AND uppercase a string in one step.
 *
 * WHY this exists: html2canvas does NOT implement CSS `text-transform`.
 * It measures text in the source case but the browser renders it uppercased,
 * so a `text-transform: uppercase` rule makes html2canvas mis-measure glyph
 * widths — uppercase text overflows its measured box and gets clipped into
 * garbled fragments (e.g. "Garment" rendering as broken "FFF" inside a pill).
 *
 * The fix is to uppercase the text in the HTML source itself and drop the CSS
 * `text-transform` rule, so html2canvas measures and renders the same string.
 * Use `upper()` for every label/pill/badge that previously relied on CSS
 * uppercasing.
 */
function upper(s: string | null | undefined): string {
  return esc((s ?? "").toUpperCase());
}

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Slugify a name for use in a filename — keeps alphanumerics and spaces,
 * collapses runs of whitespace / punctuation, trims, and clips the length.
 * Returns "" when the name is empty so callers can omit the segment entirely.
 */
function nameSlug(s: string | null | undefined, maxLen = 40): string {
  if (!s) return "";
  return s
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // keep letters/numbers (any script), spaces, hyphens
    .replace(/\s+/g, " ")
    .replace(/\s/g, "-")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/**
 * Convert a relative URL to an absolute URL the PDF renderer / fetch can load.
 *
 * ORDER MATTERS: try `resolveAssetUrl` FIRST. It correctly maps `/uploads/*`
 * to the BACKEND origin (e.g. http://localhost:8000), since uploads are served
 * from FastAPI's StaticFiles mount. Calling `publicAssetAbsoluteUrl` first
 * would wrongly prepend the FRONTEND origin (Next.js dev server, e.g.
 * http://localhost:3000) which has no /uploads/* route and would 404 —
 * silently breaking image inlining and producing blank image slots in the PDF.
 */
function absUrl(u: string | null | undefined): string {
  return (
    resolveAssetUrl(u) ??
    publicAssetAbsoluteUrl(u) ??
    ""
  );
}

/**
 * Resolve an asset URL to a FULLY-QUALIFIED absolute URL for things opened
 * OUTSIDE the browser context: PDF link annotations and QR codes. Unlike
 * `absUrl` (which deliberately collapses to a same-origin relative path so
 * in-browser <img>/fetch go through the Next.js proxy), a QR code scanned by
 * a phone or a link clicked inside a PDF viewer has no "current origin" to
 * resolve against — a relative `/uploads/foo.mp3` is useless there. So we
 * always emit the real backend origin (the FastAPI StaticFiles host that
 * actually serves /uploads/*).
 */
const BE_ORIGIN = (
  process.env.NEXT_PUBLIC_API_URL ?? "/api/v1"
).replace(/\/api\/v\d+$/, "");

function externalAbsUrl(u: string | null | undefined): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `${BE_ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`;
}

// ─── Section builders ────────────────────────────────────────────────────

function coverPage(
  job: MeasurementJobRow,
  customer: UserRow | null,
  order: OrderRow | null,
  voiceNote?: { url: string; qrDataUrl: string } | null,
  showCustomerDetails: boolean = true,
  address?: AddressRow | null,
): string {
  const ord = order ?? null;

  // Optional customer contact rows. When `showCustomerDetails` is true we
  // append phone / email / address to the Customer Details block; when false
  // the cover stays as the original two rows (Name, Customer ID). The rows
  // reuse the existing `.kv` table styles; the address is multi-line so it
  // gets the dedicated `.address-body` card (its CSS already exists).
  const contactRows = showCustomerDetails
    ? `
        <tr><th>Phone</th><td>${esc(customer?.phone ?? "—")}</td></tr>
        <tr><th>Email</th><td>${esc(customer?.email ?? "—")}</td></tr>
      `
    : "";

  const addressBlock =
    showCustomerDetails && address
      ? `<tr><th>Address</th><td>${formatAddressInline(address)}</td></tr>`
      : "";

  // Voice-note CTA. The PDF body is rasterized to JPEG, so inline <a> links
  // don't survive — we render a QR (works on phone or print) AND a visual
  // "Listen" button. After rasterizing the cover page we overlay a real PDF
  // link annotation on top of that button's position (see the jsPDF loop), so
  // the button is genuinely clickable in digital PDF viewers. Rendered only
  // when a voice note URL was recorded at the end of the measurement job.
  const voiceNoteUrl = voiceNote?.url;
  const voiceNoteBlock = voiceNote?.qrDataUrl
    ? `<div class="voice-note-cta">
         <div class="voice-note-qr">
           <img src="${voiceNote.qrDataUrl}" alt="Voice note QR code" />
         </div>
         <div class="voice-note-copy">
           <h2>🎙️ Voice Note</h2>
           <p>The style captain recorded an audio note during measurement.</p>
           <p class="voice-note-instr">Scan the QR code, or tap the button, to listen.</p>
         </div>
         ${
           voiceNoteUrl
             ? `<a href="${esc(voiceNoteUrl)}" class="voice-note-btn" target="_blank" rel="noopener">
                  <span class="voice-note-btn-icon" aria-hidden="true">▶</span>
                  Listen to recording
                </a>`
             : ""
         }
       </div>`
    : "";

  return `
    <section class="page cover-page">
      <header class="brand-header">
        <h1>DRAEP</h1>
        <div class="subtitle">Measurement Report</div>
      </header>

      <div class="cover-grid">
        <div class="cover-block">
          <h2>${upper("Order Details")}</h2>
          <table class="kv">
            <tr><th>Order No.</th><td>${esc(ord?.order_number ?? "—")}</td></tr>
            <tr><th>Order ID</th><td>${esc(ord?.id ?? "—")}</td></tr>
            <tr><th>Created</th><td>${fmtDateTime(ord?.created_at ?? null)}</td></tr>
            <tr><th>Slot</th><td>${esc(formatOrderSlot(ord?.slot))}</td></tr>
            <tr><th>Job Status</th><td>${esc(job.status ?? "—")}</td></tr>
            <tr><th>Scheduled</th><td>${fmtDateTime(job.scheduled_at)}</td></tr>
            <tr><th>Performed</th><td>${fmtDateTime(job.performed_at)}</td></tr>
          </table>
        </div>

        <div class="cover-block">
          <h2>${upper("Customer Details")}</h2>
          <table class="kv">
            <tr><th>Name</th><td>${esc(customer?.name ?? "—")}</td></tr>
            <tr><th>Customer ID</th><td>${esc(customer?.id ?? job.user_id ?? "—")}</td></tr>
            ${contactRows}
            ${addressBlock}
          </table>
        </div>
      </div>

      ${voiceNoteBlock}

      <div class="cover-block notes-block">
        <h2>${upper("Notes")}</h2>
        <div class="notes-body">${esc(job.notes?.trim()) || "<em class='muted'>No notes recorded.</em>"}</div>
      </div>

      <footer class="report-footer">
        Generated ${new Date().toLocaleString("en-IN")} • Job ID ${esc(job.id)}
      </footer>
    </section>
  `;
}

function formatOrderSlot(slot: unknown): string {
  if (!slot || typeof slot !== "object") return "—";
  const s = slot as Record<string, unknown>;
  const date = s.date ?? s.start ?? "—";
  const start = s.start_time ?? s.start ?? "";
  const end = s.end_time ?? s.end ?? "";
  if (start && end) return `${date} (${start}–${end})`;
  return String(date);
}

/**
 * Render an address as a single-line, escaped HTML string for use inside a
 * `.kv` table cell. Empty segments are dropped; the rest are joined with
 * ", ". Returns "—" when there's nothing to show.
 */
function formatAddressInline(addr: AddressRow | null | undefined): string {
  if (!addr) return "—";
  const parts = [
    addr.address_line_1,
    addr.address_line_2,
    addr.city,
    addr.state,
    addr.pincode,
  ].filter((p) => p != null && String(p).trim() !== "");
  if (parts.length === 0) return "—";
  return esc(parts.join(", "));
}

/**
 * `garment_orders_items.placement` is a JSONB array on rows written by the
 * customer flow and the admin editor (["Sleeves"]), but a scalar string on
 * rows written by older admin flows. Normalize to a display string.
 */
function placementText(p: string | string[] | null | undefined): string | null {
  if (Array.isArray(p)) return p.length > 0 ? p.join(", ") : null;
  return p ?? null;
}

/**
 * Best-effort display label for a garment-order item, mirroring the page's
 * `itemDisplayLabel`. The label_snapshot column is JSONB, so the generic
 * tables API returns it as an object like {en: "Blouse cut → Princess cut"};
 * a JSON string is also accepted. Falls back to the raw string if it isn't
 * JSON, then to type/placement. Items carry immutable label snapshots stamped
 * at checkout, so this never needs the live catalog.
 */
function itemLabelText(it: GarmentOrderItemRow): string {
  const snap = it.label_snapshot;
  if (snap) {
    if (typeof snap === "object") {
      const text = snap.en ?? Object.values(snap)[0];
      if (text) return String(text);
    } else {
      try {
        const parsed = JSON.parse(snap) as Record<string, string>;
        const text = parsed.en ?? parsed[Object.keys(parsed)[0] ?? ""];
        if (text) return text;
      } catch {
        return snap;
      }
    }
  }
  const type = it.type === "add_on" ? "Add-on" : "Selection";
  const placement = placementText(it.placement);
  return placement ? `${type} (${placement})` : type;
}

// ─── Per-garment section: style selections · inspiration · measurements · cloth ──
//
// ONE section per garment order, flowing across as many A4 pages as its
// content needs (numbered "GARMENT n: <name>" with the GO id in the hero):
//
//   2.1 STYLE SELECTIONS  — simple table: Titles | Selected Titles |
//                           Selected Descriptions (every language, catalogue
//                           titles + descriptions resolved by the caller)
//   2.2 DESIGN INSPIRATION — customer photos, explicitly framed as reference
//                           only ("not to be copied as-is")
//   2.3 GARMENT MEASUREMENTS — this instance's readings: table with the
//                           metric image, titles, descriptions, big value
//   2.4 CLOTH & MATERIALS  — color banners / photos per material
//   +   customer note (when present)
//
// Subsections are gated by the SAME PdfSectionOptions toggles as before the
// restructure: designDetails → 2.1+2.2, measurementDetails → 2.3,
// fabricDetails → 2.4. Pages are planned from REAL measured heights (probe
// render, below) so nothing is ever cropped by the fixed-A4 rasterizer.

/** Languages rendered for titles/descriptions, in display order. */
const STYLE_LANGS = ["en", "hi", "kn"] as const;

const rupeeFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** ₹ amount for the style-table price tag (items are whole rupees). */
function fmtRupees(n: number): string {
  return rupeeFormat.format(n);
}

/** .page vertical geometry from PRINT_CSS: 1123px, 60px top + 68px bottom padding. */
const GS_PAGE_CONTENT_H = 1123 - 60 - 68;
/** Slack for sub-pixel rounding / font drift between the probe and the render. */
const GS_SAFETY = 24;
/** .gs-table margin-bottom (12pt) — paid once per page a table renders on. */
const GS_TABLE_MARGIN = 16;
/** .materials-list gap (14pt) between stacked material cards. */
const GS_STACK_GAP = 19;

/** One subsection of a garment section. Content is pre-built HTML so it can
 *  be probed for height BEFORE the page-count math runs. */
interface GarmentSectionBlock {
  /** Subsection heading ("" = none — e.g. the trailing customer note). */
  label: string;
  kind: "table" | "stack" | "atomic";
  /** table: full <thead> html; rows are <tr> html, packed one-by-one. */
  thead?: string;
  rows?: string[];
  /** stack: self-contained html pieces (e.g. material cards), packed one-by-one. */
  pieces?: string[];
  /** atomic: one html blob that moves to a new page whole. */
  html?: string;
  /** Filled by the probe: */
  labelHeight?: number;
  theadHeight?: number;
  rowHeights?: number[];
  htmlHeight?: number;
}

/** A garment measurement group paired with its style selections. */
interface GarmentSectionInput {
  /** garment_order id — pagination + pairing key. */
  key: string;
  group: GarmentMeasurementGroup;
  style: StyleSelectionGroup | null;
  /** 1-based display number ("GARMENT 1: …"), assigned after empty sections
   *  are dropped so numbering never skips. */
  number: number;
  /** <h2> override for non-garment sections reusing this flow (the
   *  order-level body measurements table). */
  headerTitle?: string;
  /** Skip the style-hero chrome — non-garment sections have no GO hero. */
  hideHero?: boolean;
  /** Prebuilt blocks — when set the planner uses them verbatim and ignores
   *  group/style (see the body measurements section in the orchestrator). */
  prebuiltBlocks?: GarmentSectionBlock[];
}

/** A planned page: which blocks land on it, and which rows/pieces of each. */
interface GsPageEntry {
  block: number;
  rows?: number[];
  pieces?: number[];
}

interface GarmentSectionMeasured {
  blocks: GarmentSectionBlock[];
  pages: GsPageEntry[][];
}

/** Pagination key of the order-level body-measurements section (an id-space
 *  of its own so it can never collide with a garment_order id). */
const BODY_SECTION_KEY = "__body_measurements__";

// ── Shared helpers for titles / native names / descriptions ────────────────

/** Split a checkout label on " → " into component + choice.
 *  e.g. "Blouse cut → Princess cut" → "Blouse cut" / "Princess cut". */
function splitItemLabel(label: string): { component: string | null; choice: string } {
  const i = label.indexOf("→");
  if (i < 0) return { component: null, choice: label };
  return { component: label.slice(0, i).trim(), choice: label.slice(i + 1).trim() };
}

/** Native-language names (everything except English) joined with " · ". */
function nativeNames(labels: Record<string, string> | null | undefined): string | null {
  if (!labels) return null;
  const natives = STYLE_LANGS.filter((l) => l !== "en")
    .map((l) => labels[l]?.trim())
    .filter((v): v is string => Boolean(v));
  return natives.length > 0 ? natives.join(" · ") : null;
}

/** One description line per language that has one (English first), each
 *  source-truncated — html2canvas has no line-clamp, so clamp here. */
function descLines(descs: Record<string, string> | null | undefined, max = 160): string[] {
  if (!descs) return [];
  return STYLE_LANGS.map((l) => descs[l]?.trim())
    .filter((v): v is string => Boolean(v))
    .map((v) => (v.length > max ? `${v.slice(0, max - 3)}…` : v));
}

/** Native-language title lines for a multilingual labels dict. */
function nativeTitleLines(labels: Record<string, string> | null | undefined): string[] {
  if (!labels) return [];
  return STYLE_LANGS.filter((l) => l !== "en")
    .map((l) => labels[l]?.trim())
    .filter((v): v is string => Boolean(v));
}

// ── 2.1 Style selections table ──────────────────────────────────────────────

const STYLE_TABLE_THEAD = `
  <thead>
    <tr>
      <th class="gs-th gs-th-title">Titles</th>
      <th class="gs-th gs-th-choice">Selected Titles</th>
      <th class="gs-th gs-th-desc">Selected Descriptions</th>
    </tr>
  </thead>`;

/** One <tr>: component (+native, blurb, add-on badge) | choice (+native,
 *  price, placement) | per-language choice descriptions. */
function styleSelectionRow(
  it: GarmentOrderItemRow,
  detail: StyleItemDetail | undefined,
  isAddon: boolean,
): string {
  const { component, choice } = splitItemLabel(itemLabelText(it));
  const placement = placementText(it.placement);

  const compLabels = detail?.componentLabels ?? null;
  const compEn = compLabels?.en?.trim() || component;
  const compNative = nativeNames(compLabels);
  const compDesc = detail?.componentDescriptions?.en?.trim() ?? null;

  const chLabels = detail?.choiceLabels ?? null;
  const choiceEn = chLabels?.en?.trim() || choice;
  const choiceNative = nativeNames(chLabels);
  const choiceDescs = descLines(detail?.choiceDescriptions ?? null);

  return `
    <tr>
      <td class="gs-td gs-td-title">
        <div class="gs-comp">${esc(compEn ?? (isAddon ? "Add-on" : "Selection"))}</div>
        ${compNative ? `<div class="gs-native">${esc(compNative)}</div>` : ""}
        ${compDesc ? `<div class="gs-comp-desc">${esc(compDesc.length > 120 ? `${compDesc.slice(0, 117)}…` : compDesc)}</div>` : ""}
        ${isAddon ? `<span class="gs-addon-badge">${upper("Add-on")}</span>` : ""}
      </td>
      <td class="gs-td gs-td-choice">
        <div class="gs-choice">${esc(choiceEn || "—")}</div>
        ${choiceNative ? `<div class="gs-native">${esc(choiceNative)}</div>` : ""}
        ${it.price != null && it.price !== 0 ? `<div class="gs-price">${esc(fmtRupees(it.price))}</div>` : ""}
        ${placement ? `<div class="gs-placement">${upper("Placement")}: ${esc(placement)}</div>` : ""}
      </td>
      <td class="gs-td gs-td-desc">
        ${choiceDescs.map((d) => `<div class="gs-desc-line">${esc(d)}</div>`).join("")}
      </td>
    </tr>
  `;
}

// ── 2.3 Garment measurements table ──────────────────────────────────────────

const MEAS_TABLE_THEAD = `
  <thead>
    <tr>
      <th class="gs-th gs-th-img">Measurement</th>
      <th class="gs-th gs-th-title">Titles</th>
      <th class="gs-th gs-th-desc">Descriptions</th>
      <th class="gs-th gs-th-value">Value</th>
    </tr>
  </thead>`;

/** One <tr>: metric image | titles (en + native) | descriptions (per
 *  language) | big value. Used by BOTH the garment measurement tables (2.3)
 *  and the order-level body measurements section. */
function garmentMeasurementRow(r: BodyMeasurementWithMetric): string {
  const labels = r.metric.labels ?? {};
  const descriptions = r.metric.descriptions ?? {};
  const imageUrl = absUrl(r.metric.asset_urls?.[0] ?? null);
  const natives = nativeTitleLines(labels);
  const descs = descLines(descriptions, 120);

  const reading = r.reading;
  let valueHtml = `<div class="gs-mval gs-mval-empty">—</div>`;
  if (reading?.value_numeric !== null && reading?.value_numeric !== undefined) {
    const unit = reading.unit ?? r.metric.unit ?? null;
    valueHtml = `
      <div class="gs-mval">${esc(String(reading.value_numeric))}</div>
      ${unit ? `<div class="gs-mval-unit">${esc(unit)}</div>` : ""}`;
  } else if (reading?.value_text) {
    valueHtml = `<div class="gs-mval gs-mval-text">${esc(reading.value_text)}</div>`;
  }

  return `
    <tr>
      <td class="gs-td gs-td-img">
        ${
          imageUrl
            ? `<img src="${imageUrl}"
                   data-pdf-src="${esc(r.metric.asset_urls?.[0] ?? "")}"
                   alt="${esc(labels.en ?? r.metric.code ?? "metric")}" />`
            : `<div class="gs-img-placeholder">No image</div>`
        }
      </td>
      <td class="gs-td gs-td-title">
        <div class="gs-comp">${esc(labels.en ?? r.metric.code ?? "—")}</div>
        ${natives.map((n) => `<div class="gs-native">${esc(n)}</div>`).join("")}
      </td>
      <td class="gs-td gs-td-desc">
        ${descs.map((d) => `<div class="gs-desc-line">${esc(d)}</div>`).join("")}
      </td>
      <td class="gs-td gs-td-value">${valueHtml}</td>
    </tr>
  `;
}

// ── 2.2 Inspiration · 2.4 materials · note ─────────────────────────────────

/** Customer-uploaded inspiration photos + the reference-only disclaimer. */
function inspirationHtml(style: StyleSelectionGroup): string {
  const urls = (style.assetsShared ?? [])
    .map((u) => (typeof u === "string" ? u : null))
    .filter((u): u is string => Boolean(u));
  if (urls.length === 0) return "";
  return `
    <div class="gs-note"><strong>${upper("Reference only")}:</strong> ${
      esc("these are inspiration images shared by the customer — indicative of look and feel, NOT to be copied as-is.")
    }</div>
    <div class="photo-grid">
      ${urls
        .map(
          (u) =>
            `<img src="${absUrl(u)}"
                   data-pdf-src="${esc(u)}"
                   alt="${esc(style.garmentLabel)} design inspiration" />`,
        )
        .join("")}
    </div>
  `;
}

/** One material card — color banner, dimensions, photos (as on the old
 *  garment-details page, so no fabric information is lost in the merge). */
function materialCardHtml(
  m: GarmentMeasurementGroup["materials"][number],
  garmentLabel: string,
): string {
  const dims =
    m.length !== null || m.breadth !== null
      ? `${m.length ?? "—"} × ${m.breadth ?? "—"}${m.unit ? ` ${m.unit}` : ""}`
      : null;

  const colorBlock = m.color
    ? `<div class="color-banner" style="background:${esc(m.color)};">
         <span class="color-banner-label">${esc(m.color)}</span>
       </div>`
    : `<div class="color-banner color-banner-empty">
         <span class="color-banner-label">No color recorded</span>
       </div>`;

  // data-pdf-src marker → pre-rasterized <canvas> before html2canvas runs.
  const photoImgs = (m.asset_urls ?? [])
    .map(
      (u) =>
        `<img src="${absUrl(u)}"
               data-pdf-src="${esc(u)}"
               alt="${esc(m.name ?? m.type ?? "material photo")}" />`,
    )
    .join("");

  const photoGrid = photoImgs
    ? `<div class="photo-grid">${photoImgs}</div>`
    : `<div class="photo-grid photo-grid-empty"><em>No photos captured.</em></div>`;

  return `
    <div class="material-card">
      <div class="material-meta">
        ${m.type ? `<span class="meta-pill">${upper(m.type)}</span>` : ""}
        ${m.name ? `<span class="meta-name">${esc(m.name)}</span>` : ""}
        ${dims ? `<span class="meta-dim">Dimensions: ${esc(dims)}</span>` : ""}
      </div>
      ${colorBlock}
      ${m.comment ? `<div class="material-comment">${esc(m.comment)}</div>` : ""}
      ${photoGrid}
    </div>
  `;
}

/** Display name for a garment section (measurement group wins — it has the
 *  live catalogue labels — style label is the fallback). */
function garmentSectionLabel(group: GarmentMeasurementGroup, style: StyleSelectionGroup | null): string {
  return (
    group.garmentLabels?.en ??
    group.garmentSlug ??
    style?.garmentLabel ??
    "Garment"
  );
}

/** Build a section's subsection blocks, gated by the section toggles. */
function buildGarmentSectionBlocks(
  group: GarmentMeasurementGroup,
  style: StyleSelectionGroup | null,
  opts: PdfSectionOptions,
): GarmentSectionBlock[] {
  const blocks: GarmentSectionBlock[] = [];
  const garmentLabel = garmentSectionLabel(group, style);

  // 2.1 Style selections — simple 3-column table.
  if (opts.designDetails && style) {
    const variations = style.items.filter((it) => it.type === "variation");
    const addons = style.items.filter((it) => it.type === "add_on");
    if (style.items.length > 0) {
      const detailById = new Map<string, StyleItemDetail>();
      style.items.forEach((it, idx) => {
        const d = style.itemDetails?.[idx];
        if (d) detailById.set(it.id, d);
      });
      const rows = [...variations, ...addons].map((it) =>
        styleSelectionRow(it, detailById.get(it.id), it.type === "add_on"),
      );
      blocks.push({
        label: "Style Selections",
        kind: "table",
        thead: STYLE_TABLE_THEAD,
        rows,
      });
    } else {
      blocks.push({
        label: "Style Selections",
        kind: "atomic",
        html: `<p class="muted">No style selections recorded for this garment order.</p>`,
      });
    }

    // 2.2 Design inspiration (only when photos exist — with the disclaimer).
    const insp = inspirationHtml(style);
    if (insp) {
      blocks.push({ label: "Design Inspiration", kind: "atomic", html: insp });
    }
  }

  // 2.3 Garment measurements — image / titles / descriptions / big value.
  const readings = (group.readings ?? []).filter((r) => r.reading);
  if (opts.measurementDetails && readings.length > 0) {
    blocks.push({
      label: "Garment Measurements",
      kind: "table",
      thead: MEAS_TABLE_THEAD,
      rows: readings.map(garmentMeasurementRow),
    });
  }

  // 2.4 Cloth & materials — one stackable card per material.
  if (opts.fabricDetails && group.materials.length > 0) {
    blocks.push({
      label: "Cloth & Materials",
      kind: "stack",
      pieces: group.materials.map((m) => materialCardHtml(m, garmentLabel)),
    });
  }

  if (group.userNote || style?.garmentOrder.user_note) {
    blocks.push({
      label: "",
      kind: "atomic",
      html: `<div class="user-note"><strong>Customer note:</strong> ${esc(
        group.userNote ?? style?.garmentOrder.user_note ?? "",
      )}</div>`,
    });
  }

  return blocks;
}

/** Hero + header + footer chrome shared by the probe and the emitter —
 *  identical markup ⇒ identical measured heights. */
const gsHeaderHtml = (section: GarmentSectionInput, pageNum: number, totalPages: number): string => {
  const title =
    section.headerTitle != null
      ? esc(section.headerTitle)
      : `${upper("Garment")} ${section.number}: ${esc(garmentSectionLabel(section.group, section.style))}`;
  return `
  <header class="page-header">
    <h2>${title}</h2>
    <div class="page-num">Page ${pageNum} of ${totalPages}</div>
  </header>`;
};

const gsHeroHtml = (section: GarmentSectionInput, continued: boolean): string => {
  if (section.hideHero) return "";
  const g = section.group;
  const style = section.style;
  const counts = (() => {
    if (!style) return null;
    const variations = style.items.filter((it) => it.type === "variation").length;
    const addons = style.items.filter((it) => it.type === "add_on").length;
    const parts = [
      variations > 0 ? `${variations} selection${variations > 1 ? "s" : ""}` : null,
      addons > 0 ? `${addons} add-on${addons > 1 ? "s" : ""}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  })();
  const label = garmentSectionLabel(g, style);
  return `
    <div class="style-hero">
      <div class="style-hero-label">${esc(label)}${continued ? ` — ${upper("continued")}` : ""}</div>
      <div class="style-hero-meta">
        <span>GO ${esc(g.garmentOrderId.slice(0, 8))}</span>
        ${(g.status ?? style?.garmentOrder.status)
          ? `<span class="style-hero-status">${upper((g.status ?? style?.garmentOrder.status ?? "").replace(/_/g, " "))}</span>`
          : ""}
        ${counts ? `<span class="style-hero-counts">${esc(counts)}</span>` : ""}
      </div>
    </div>`;
};

const gsFooterHtml = (pageNum: number, totalPages: number): string =>
  `<footer class="report-footer">DRAEP Measurement Report • Page ${pageNum} of ${totalPages}</footer>`;

/** Fully render one block (probe form: label + ALL its content). */
function gsBlockHtml(b: GarmentSectionBlock): string {
  const label = b.label ? `<div class="style-section-label">${upper(b.label)}</div>` : "";
  if (b.kind === "table") {
    return `${label}<table class="gs-table">${b.thead ?? ""}<tbody>${(b.rows ?? []).join("")}</tbody></table>`;
  }
  if (b.kind === "stack") {
    return `${label}<div class="materials-list">${(b.pieces ?? []).join("")}</div>`;
  }
  return `${label}${b.html ?? ""}`;
}

/**
 * Probe-measure every section's blocks in an offscreen document (same
 * PRINT_CSS, same 794px width) and plan the A4 page split. html2canvas
 * rasterizes each `.page` as a fixed A4 frame — taller content is CROPPED —
 * so the plan is built from real heights, before any "Page N of T" footer
 * exists. Packing rules:
 *   - a subsection label never ends a page alone (stays with its first row)
 *   - table rows / stack pieces pack one-by-one; a table re-prints its
 *     <thead> on every page it continues (the emitter composes per page)
 *   - an atomic block moves to a new page whole
 *   - every page gets ≥ 1 item, even a single oversized one.
 */
async function measureGarmentSections(
  sections: GarmentSectionInput[],
  opts: PdfSectionOptions,
): Promise<Map<string, GarmentSectionMeasured>> {
  const built = sections.map((s) => ({
    section: s,
    blocks: s.prebuiltBlocks ?? buildGarmentSectionBlocks(s.group, s.style, opts),
  }));

  const holder = document.createElement("div");
  holder.setAttribute("data-pdf-measure-holder", "");
  holder.style.position = "fixed";
  holder.style.zIndex = "-9999";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.width = "794px";
  holder.style.background = "#ffffff";
  holder.style.pointerEvents = "none";
  holder.innerHTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><style>${PRINT_CSS}</style></head>
<body>
  ${built
    .map(
      ({ section, blocks }) => `
    <section class="page garment-page" data-measure-sec="${esc(section.key)}">
      ${gsHeaderHtml(section, 1, 1)}
      ${gsHeroHtml(section, false)}
      ${blocks
        .map(
          (b, bi) => `
        <div data-mblk="${bi}">${gsBlockHtml(b)}</div>`,
        )
        .join("")}
      ${gsFooterHtml(1, 1)}
    </section>`,
    )
    .join("")}
</body>
</html>`;
  document.body.appendChild(holder);
  try {
    await nextPaint();
    try {
      await waitForImages(holder); // images change block heights
    } catch {
      /* never block pagination on a slow image */
    }
    await nextPaint();

    const map = new Map<string, GarmentSectionMeasured>();
    for (const { section, blocks } of built) {
      const sec = holder.querySelector<HTMLElement>(
        `[data-measure-sec="${section.key}"]`,
      );
      if (!sec) continue;

      // Block height incl. vertical margins — the space it consumes in the
      // page's flex column.
      const blockH = (el: HTMLElement | null): number => {
        if (!el) return 0;
        const cs = getComputedStyle(el);
        return (
          el.getBoundingClientRect().height +
          parseFloat(cs.marginTop) +
          parseFloat(cs.marginBottom)
        );
      };
      const headerH = blockH(sec.querySelector(".page-header"));
      const heroH = blockH(sec.querySelector(".style-hero"));
      // Footer height WITHOUT its margin-top: it's `margin-top: auto` (the
      // flex filler pinning the footer to the page bottom). On a probe page
      // shorter than A4 that filler resolves to the whole leftover gap
      // (hundreds of px) — counting it would crush the budget; the real page
      // treats it as free space.
      const footerH = sec.querySelector<HTMLElement>(".report-footer")?.getBoundingClientRect()
        .height ?? 0;
      const budget =
        GS_PAGE_CONTENT_H - headerH - heroH - footerH - GS_SAFETY;

      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const wrap = sec.querySelector<HTMLElement>(`[data-mblk="${bi}"]`);
        b.labelHeight = b.label
          ? blockH(wrap?.querySelector(".style-section-label") ?? null)
          : 0;
        if (b.kind === "table") {
          b.theadHeight = blockH(wrap?.querySelector("thead") ?? null);
          b.rowHeights = Array.from(
            wrap?.querySelectorAll("tbody tr") ?? [],
          ).map((tr) => (tr as HTMLElement).getBoundingClientRect().height + 1);
        } else if (b.kind === "stack") {
          b.rowHeights = Array.from(
            wrap?.querySelectorAll(".materials-list > *") ?? [],
          ).map((el) => (el as HTMLElement).getBoundingClientRect().height + GS_STACK_GAP);
        } else {
          // Whole wrapper minus the separately-counted label — an atomic may
          // hold MULTIPLE children (e.g. .gs-note + .photo-grid for the
          // inspiration block), and the wrapper is a flex item (BFC root),
          // so its rect fully contains the label's margins.
          b.htmlHeight = Math.max(
            0,
            blockH(wrap) - (b.label ? (b.labelHeight ?? 0) : 0),
          );
        }
      }

      // ── Plan pages (greedy fill, label keeps with its first item) ──
      const pages: GsPageEntry[][] = [];
      let cur: GsPageEntry[] = [];
      let used = 0;
      const closePage = () => {
        if (cur.length > 0) {
          pages.push(cur);
          cur = [];
          used = 0;
        }
      };

      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const itemHs = b.rowHeights ?? [];

        if (b.kind === "atomic") {
          const cost = (b.labelHeight ?? 0) + (b.htmlHeight ?? 0);
          if (cur.length > 0 && used + cost > budget) closePage();
          cur.push({ block: bi });
          used += cost;
          continue;
        }

        // table / stack: pack items one-by-one. An item that doesn't fit on
        // the current page moves to the NEXT page BEFORE being placed — the
        // rasterizer crops at 1123px, so an "overflow-by-one-row" page loses
        // content. Only a page that would otherwise stay empty keeps an
        // oversized item. The first item on a page additionally pays label
        // (block's first page only) + thead (tables) + the per-page table
        // margin; the emitter suppresses the label after the block's first
        // page, matching this accounting.
        const openCost = (firstForBlock: boolean, isTable: boolean): number =>
          (firstForBlock ? (b.labelHeight ?? 0) : 0) +
          (isTable ? (b.theadHeight ?? 0) + GS_TABLE_MARGIN : 0);
        let blockStarted = false;
        let i = 0;
        let entry: GsPageEntry | null = null;
        while (i < itemHs.length) {
          const h = itemHs[i];
          if (entry !== null) {
            // Continuation item on a shared page: must fit.
            if (used + h > budget) {
              closePage();
              entry = null;
              continue;
            }
          } else {
            // Opening this block on the current page (possibly with other
            // blocks already there): label + thead + first row must fit.
            const open = openCost(!blockStarted, b.kind === "table");
            if (cur.length > 0 && used + open + h > budget) {
              closePage();
              continue;
            }
            entry = { block: bi, ...(b.kind === "table" ? { rows: [] } : { pieces: [] }) };
            cur.push(entry);
            used += open;
            blockStarted = true;
          }
          if (b.kind === "table") entry?.rows?.push(i);
          else entry?.pieces?.push(i);
          used += h;
          i++;
        }
        // An empty rows array (shouldn't happen — blocks are only built with
        // content) still emits the label alone on the current page.
        if (!blockStarted && itemHs.length === 0) {
          cur.push({ block: bi });
          used += (b.labelHeight ?? 0);
        }
      }
      closePage();
      if (pages.length === 0) pages.push([]);

      map.set(section.key, { blocks, pages });
    }
    return map;
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}

/**
 * Emit a garment section's planned pages: header + hero on every page
 * ("— CONTINUED" from page 2 on), each subsection's label on its first page,
 * tables re-printing their <thead> on every page they continue.
 */
function garmentSectionPages(
  section: GarmentSectionInput,
  measured: GarmentSectionMeasured | null,
  startPageNum: number,
  totalPageCount: number,
): { html: string; pages: number } {
  // Unmeasured fallback (never hit on the normal path): everything on one page.
  const blocks =
    measured?.blocks ??
    section.prebuiltBlocks ??
    buildGarmentSectionBlocks(section.group, section.style, ALL_SECTIONS);
  const pages =
    measured?.pages ??
    [blocks.map((b, bi) => (b.kind === "table" ? { block: bi, rows: (b.rows ?? []).map((_, i) => i) } : { block: bi, pieces: b.pieces?.map((_, i) => i) }))];

  // First page index each block appears on → suppress its label afterwards.
  const firstPageOfBlock = new Map<number, number>();
  pages.forEach((entries, pi) => {
    for (const e of entries) {
      if (!firstPageOfBlock.has(e.block)) firstPageOfBlock.set(e.block, pi);
    }
  });

  let pageNum = startPageNum;
  const html = pages
    .map((entries, pi) => {
      const current = pageNum++;
      const body = entries
        .map((e) => {
          const b = blocks[e.block];
          const showLabel = firstPageOfBlock.get(e.block) === pi && b.label;
          const label = showLabel
            ? `<div class="style-section-label">${upper(b.label)}</div>`
            : "";
          if (b.kind === "table") {
            const rows = (e.rows ?? []).map((ri) => b.rows?.[ri] ?? "").join("");
            return `${label}<table class="gs-table">${b.thead ?? ""}<tbody>${rows}</tbody></table>`;
          }
          if (b.kind === "stack") {
            const pieces = (e.pieces ?? []).map((pi2) => b.pieces?.[pi2] ?? "").join("");
            return `${label}<div class="materials-list">${pieces}</div>`;
          }
          return `${label}${b.html ?? ""}`;
        })
        .join("");
      return `
        <section class="page ${section.hideHero ? "body-page" : "garment-page"}">
          ${gsHeaderHtml(section, current, totalPageCount)}
          ${gsHeroHtml(section, pi > 0)}
          ${body}
          ${gsFooterHtml(current, totalPageCount)}
        </section>
      `;
    })
    .join("");
  return { html, pages: pages.length };
}

// (The standalone style-selections page builder and its measured-pagination
// machinery were folded into the unified per-garment section above when the
// PDF was restructured — see buildGarmentSectionBlocks / measureGarmentSections.)

// ─── Public entry point ──────────────────────────────────────────────────

export interface JobPdfInput {
  job: MeasurementJobRow;
  customer: UserRow | null;
  order: OrderRow | null;
  address?: AddressRow | null;
  bodyMeasurements: BodyMeasurementWithMetric[];
  garmentMeasurements: GarmentMeasurementGroup[];
  /**
   * Optional per-garment-order style selections (component → variation →
   * variation_type, add-ons, prices). When provided, a "Style Selections"
   * page is rendered for each garment order.
   */
  styleSelections?: StyleSelectionGroup[];
  /**
   * Which sections to include. Omit (or pass all-true) to get the default
   * report. The cover page always renders; these flags only gate the
   * content sections and the cover's customer-details enrichment.
   */
  sections?: PdfSectionOptions;
  /**
   * Optional embedded tax-invoice page (the same one-page invoice the
   * "Download Invoice PDF" button produces — built by invoice-pdf.ts).
   * Rasterized separately and inserted after the per-garment pages,
   * only when `sections.invoice` is true (default) AND this field is
   * provided.
   */
  invoice?: InvoiceInput;
}

/**
 * Progress callback — called with `(current, total, label)` as each page is
 * rasterized and added to the PDF. Used by callers to render a real-time
 * progress indicator instead of a generic spinner.
 */
export type PdfProgressFn = (current: number, total: number, label: string) => void;

/**
 * Build the full HTML document, render it off-screen, rasterize each `.page`
 * element with html2canvas, then assemble a multi-page PDF with jsPDF and
 * trigger a direct file download via file-saver.
 *
 * No browser print dialog is opened — the file starts downloading as soon as
 * the PDF is assembled. Progress is reported in real time via `onProgress`
 * (if provided) so callers can show "Generating page 3 of 8…".
 */
export async function downloadMeasurementJobPdf(
  input: JobPdfInput,
  onProgress?: PdfProgressFn,
): Promise<void> {
  if (typeof window === "undefined") return;
  const {
    job,
    customer,
    order,
    address,
    bodyMeasurements,
    garmentMeasurements,
    styleSelections,
    sections,
    invoice,
  } = input;

  // Resolve section toggles. Default = all on, so omitting `sections` (or any
  // individual flag) reproduces the pre-customization report exactly.
  const opts: PdfSectionOptions = { ...ALL_SECTIONS, ...(sections ?? {}) };

  // Lazily import the heavy libraries so they don't bloat the main bundle
  // (Next.js code-splits dynamic imports automatically).
  const [{ default: html2canvas }, jspdfMod, { default: saveAs }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    import("file-saver"),
  ]);
  const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

  onProgress?.(0, 1, "Building layout…");

  // Resolve an optional voice note recorded during the measurement job and
  // encode it as a QR code so the tailor can scan-and-listen from the PDF.
  // MUST be a fully-qualified absolute URL: a QR code is scanned by a phone
  // (no browser origin to resolve against), and the PDF link annotation is
  // clicked inside a PDF viewer. A relative "/uploads/..." would be useless
  // in both contexts.
  const voiceNoteUrl = externalAbsUrl(order?.voice_note_asset_url ?? null);
  let voiceNote: { url: string; qrDataUrl: string } | null = null;
  if (voiceNoteUrl) {
    try {
      const QR = (await import("qrcode")).default as QrLib;
      const qrDataUrl = await QR.toDataURL(voiceNoteUrl, {
        margin: 1,
        width: 320,
        color: { dark: "#1a1a1a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      voiceNote = { url: voiceNoteUrl, qrDataUrl };
    } catch (err) {
      console.warn("[job-pdf] Failed to generate voice-note QR:", err);
    }
  }

  // Compute pagination. The cover page ALWAYS renders (title page). Each
  // content section is gated by its toggle in `opts`. Page order groups
  // everything about one garment before the next:
  //   1 cover  →  [garment 1: style table + inspiration + measurements +
  //                cloth/materials, flowed over as many pages as needed]…
  //            →  invoice  →  body measurements
  // (Body measurements come LAST: a tailor reads the spec pages first, then
  //  the order-level reading table.)
  const styleGroups = styleSelections ?? [];

  // ── Merge measurement groups + style groups into ONE section per garment
  // order (paired by garment_order id; unmatched style groups — defensive —
  // become style-only sections). Sections whose enabled toggles produce no
  // content are dropped BEFORE numbering, so "GARMENT n" never skips.
  const styleByGoId = new Map(styleGroups.map((sg) => [sg.garmentOrder.id, sg]));
  const allSections: GarmentSectionInput[] = [];
  for (const g of garmentMeasurements) {
    const style = styleByGoId.get(g.garmentOrderId) ?? null;
    styleByGoId.delete(g.garmentOrderId);
    allSections.push({ key: g.garmentOrderId, group: g, style, number: 0 });
  }
  for (const sg of styleByGoId.values()) {
    allSections.push({
      key: sg.garmentOrder.id,
      group: {
        garmentOrderId: sg.garmentOrder.id,
        garmentId: null,
        garmentSlug: null,
        garmentLabels: null,
        status: null,
        userNote: null,
        materials: [],
        readings: [],
      },
      style: sg,
      number: 0,
    });
  }
  const garmentSections = allSections
    .filter((s) => buildGarmentSectionBlocks(s.group, s.style, opts).length > 0)
    .map((s, i) => ({ ...s, number: i + 1 }));

  // 3. Order-level (body) measurements — ONLY the base readings actually
  // taken for this order's job: garment-scoped readings live in their
  // garment's 2.3 table, and un-measured catalogue metrics are omitted
  // entirely. Rendered in the SAME table format as 2.3 by reusing the
  // garment-section flow with prebuilt blocks and no hero.
  const bodyRows = bodyMeasurements.filter((r) => r.reading);
  const bodySection: GarmentSectionInput | null =
    opts.measurementDetails && bodyRows.length > 0
      ? {
          key: BODY_SECTION_KEY,
          group: {
            garmentOrderId: BODY_SECTION_KEY,
            garmentId: null,
            garmentSlug: null,
            garmentLabels: null,
            status: null,
            userNote: null,
            materials: [],
            readings: [],
          },
          style: null,
          number: 0,
          headerTitle: "Body Measurements",
          hideHero: true,
          prebuiltBlocks: [
            {
              label: "",
              kind: "table",
              thead: MEAS_TABLE_THEAD,
              rows: bodyRows.map(garmentMeasurementRow),
            },
          ],
        }
      : null;

  // Garment + body sections flow across A4 pages — real block heights are
  // measured in an offscreen probe BEFORE the page-count math so the "Page N
  // of T" footers and the invoice/body offsets account for every
  // continuation page.
  onProgress?.(0, 1, "Laying out report sections…");
  const sectionsToMeasure = [
    ...garmentSections,
    ...(bodySection ? [bodySection] : []),
  ];
  const sectionMeasured =
    sectionsToMeasure.length > 0
      ? await measureGarmentSections(sectionsToMeasure, opts)
      : new Map<string, GarmentSectionMeasured>();
  const sectionPagesOf = (s: GarmentSectionInput): number =>
    sectionMeasured.get(s.key)?.pages.length ?? 1;

  // A disabled section contributes 0 pages; an enabled one contributes its
  // natural page count. An order whose garments produce no enabled content
  // gets no garment pages at all — and a job with no base readings gets no
  // body-measurements pages.
  const garmentPages = garmentSections.reduce((sum, s) => sum + sectionPagesOf(s), 0);
  const bodyPages = bodySection ? sectionPagesOf(bodySection) : 0;
  const invoicePages = opts.invoice && invoice ? 1 : 0;

  const totalPages = 1 /* cover */ + garmentPages + invoicePages + bodyPages;

  // Page-number offsets (cover is page 1); the garment middle pages all come
  // before the invoice and body sections.
  const invoiceStart = 2 + garmentPages;
  const bodyStart = invoiceStart + invoicePages;

  // Emit each garment section's pages in order. The section builder stamps
  // real page numbers (measured layout, so continuation pages are known);
  // the pageNum counter stays sequential across sections.
  const middleSections: string[] = [];
  const middleLabels: string[] = [];
  let pageNum = 2;
  for (const s of garmentSections) {
    const out = garmentSectionPages(
      s,
      sectionMeasured.get(s.key) ?? null,
      pageNum,
      totalPages,
    );
    middleSections.push(out.html);
    const label = garmentSectionLabel(s.group, s.style);
    for (let ci = 0; ci < out.pages; ci++) {
      middleLabels.push(`Garment ${s.number}: ${label}${ci > 0 ? " (cont.)" : ""}`);
    }
    pageNum += out.pages;
  }

  // Body pages flow through the same emitter as garment sections (header on
  // every page, <thead> re-printed on continuation pages).
  const bodySections: string[] = [];
  if (bodySection) {
    bodySections.push(
      garmentSectionPages(
        bodySection,
        sectionMeasured.get(bodySection.key) ?? null,
        bodyStart,
        totalPages,
      ).html,
    );
  }

  const fullHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DRAEP Measurement Report — ${esc(job.id)}</title>
  <style>
    ${PRINT_CSS}
  </style>
</head>
<body>
  ${coverPage(job, customer, order, voiceNote, opts.customerDetails, address)}
  ${middleSections.join("")}
  ${bodySections.join("")}
</body>
</html>`;

  // ── Embedded invoice page ────────────────────────────────────────────────
  // The invoice fragment (invoice-pdf.ts) ships its OWN <style> block that
  // also styles `.page` — the same class PRINT_CSS styles below. Two
  // `.page` rule sets must never be live in the document at once: with equal
  // specificity, whichever <style> came later in the DOM wins and corrupts
  // the other holder's page geometry. So the invoice is rasterized BEFORE
  // the job holder is attached (and its holder removed right after), keeping
  // each render self-consistent. The result is spliced into the jsPDF
  // document at the invoice's slot during the assembly loop below.
  let invoiceRaster: {
    imgData: string;
    /** canvas height / width — maps the raster onto the A4 mm page. */
    aspect: number;
    pageWidthPx: number;
    upiUrl: string | null;
    /** Rects in px, relative to the invoice .page (converted to mm later). */
    pill: { x: number; y: number; w: number; h: number } | null;
    qr: { x: number; y: number; w: number; h: number } | null;
  } | null = null;
  if (opts.invoice && invoice) {
    onProgress?.(invoiceStart - 1, totalPages, "Rendering invoice page…");
    await nextPaint();
    const invoiceHtml = await buildInvoiceDocumentHtml(invoice);
    const invHolder = document.createElement("div");
    invHolder.setAttribute("data-invoice-holder", "");
    invHolder.style.position = "fixed";
    invHolder.style.zIndex = "-9999";
    invHolder.style.left = "-99999px";
    invHolder.style.top = "0";
    invHolder.style.width = "794px";
    invHolder.style.background = "#ffffff";
    invHolder.style.pointerEvents = "none";
    invHolder.innerHTML = invoiceHtml;
    document.body.appendChild(invHolder);
    try {
      const invPage = invHolder.querySelector<HTMLElement>(".page");
      if (!invPage) throw new Error("No invoice page element found");
      await nextPaint();
      const invCanvas = await html2canvas(invPage, {
        scale: 3, // 3x for crisp output (~216 DPI)
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        width: invPage.offsetWidth,
        height: invPage.offsetHeight,
        windowWidth: 794,
      });
      // Geometry (px, page-relative) for the vector overlays added at
      // assembly time — the empty UPI pill gets real PDF text + a link
      // annotation, and the QR gets a clickable link. Same treatment
      // generateInvoicePdf() gives the standalone invoice.
      const invRect = invPage.getBoundingClientRect();
      const rectOf = (selector: string) => {
        const el = invHolder.querySelector<HTMLElement>(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.left - invRect.left,
          y: r.top - invRect.top,
          w: r.width,
          h: r.height,
        };
      };
      invoiceRaster = {
        imgData: invCanvas.toDataURL("image/jpeg", 0.92),
        aspect: invCanvas.height / invCanvas.width,
        pageWidthPx: invPage.offsetWidth,
        upiUrl: invoiceUpiUrl(invoice),
        pill: rectOf(".upi-pill"),
        qr: rectOf(".qr-img"),
      };
    } finally {
      if (invHolder.parentNode) invHolder.parentNode.removeChild(invHolder);
    }
  }

  // Render into an off-screen container attached to the live DOM (NOT an
  // iframe — html2canvas needs to walk the rendered tree and iframe blobs
  // sometimes block that). Container is sized so each `.page` matches A4
  // portrait at 96 DPI (≈ 794 × 1123 px). It's visually hidden but rendered.
  const holder = document.createElement("div");
  holder.setAttribute("data-pdf-holder", "");
  holder.style.position = "fixed";
  holder.style.zIndex = "-9999";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.width = "794px";
  holder.style.background = "#ffffff";
  holder.style.pointerEvents = "none";
  holder.innerHTML = fullHtml;
  document.body.appendChild(holder);

  try {
    // Inline the CSS into the rendered nodes — html2canvas doesn't read
    // stylesheets in some setups, so we mutate the embedded <style> to apply.
    // The <style> tag inside `fullHtml` is already inside `holder`, which is
    // fine; html2canvas reads computed styles from layout, not the source.

    const pageEls = Array.from(holder.querySelectorAll<HTMLElement>(".page"));
    if (pageEls.length === 0) {
      throw new Error("No pages found in PDF layout");
    }

    // Wait for all images on all pages to load (or fail) before rasterizing,
    // so we don't capture empty <img> boxes. (totalPages counts the final
    // PDF pages, invoice included — pageEls alone misses the invoice.)
    onProgress?.(0, totalPages, "Loading images…");
    // Replace every [data-pdf-src] <img> with a pre-rasterized <canvas>. This
    // sidesteps html2canvas's cross-origin image loader entirely (its loader
    // cache was silently dropping the material photo due to a cross-origin
    // attribute/taint mismatch). Canvases are copied via drawImage — no
    // network, no CORS, no taint, no blank slots.
    // Wrapped in try/catch: image loading should NEVER block the PDF download.
    try {
      await inlineImagesAsCanvases(holder);
    } catch (err) {
      console.warn("[job-pdf] image inlining failed, continuing with raw <img>:", err);
    }
    try {
      await waitForImages(holder);
    } catch (err) {
      console.warn("[job-pdf] image wait failed, continuing:", err);
    }

    // Diagnostic: confirm what's in the holder now.
    const remainingImgs = holder.querySelectorAll("img").length;
    const canvases = holder.querySelectorAll("canvas").length;
    console.info(
      `[job-pdf] after inline: ${remainingImgs} <img> remaining, ${canvases} <canvas> inlined`,
    );

    // Set up jsPDF with A4 portrait (matches @page rule in PRINT_CSS).
    // Units in mm so we can use the real A4 dimensions.
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();

    // Final page count includes the embedded invoice (pageEls holds only the
    // job-report pages), and the invoice's 0-based slot in the final PDF —
    // always ≥ 1 because the cover is page 1.
    const finalPageCount = pageEls.length + (invoiceRaster ? 1 : 0);
    const invoiceIndex = invoiceStart - 1;

    // Add the pre-rasterized invoice page + its vector overlays as the next
    // PDF page.
    const addInvoicePage = () => {
      if (!invoiceRaster) return;
      pdf.addPage();
      const imgW = pageWidthMm;
      const imgH = invoiceRaster.aspect * imgW;
      pdf.addImage(
        invoiceRaster.imgData,
        "JPEG",
        0,
        0,
        imgW,
        Math.min(imgH, pageHeightMm),
      );
      const mmPerPx = pageWidthMm / invoiceRaster.pageWidthPx;

      // Vector "Pay via UPI" label on the pill the raster left empty — real
      // PDF text, not raster, so no html2canvas quirk or JPEG compression
      // can touch it (same approach as generateInvoicePdf).
      if (invoiceRaster.pill && invoiceRaster.upiUrl) {
        const bx = invoiceRaster.pill.x * mmPerPx;
        const by = invoiceRaster.pill.y * mmPerPx;
        const bw = invoiceRaster.pill.w * mmPerPx;
        const bh = invoiceRaster.pill.h * mmPerPx;
        const label = "Pay via UPI \u00BB";
        const fontSizePt = 12;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(fontSizePt);
        pdf.setTextColor(255, 255, 255);
        const tw = pdf.getTextWidth(label);
        // jsPDF's text y is the BASELINE — nudge down by ~cap-height/2 to
        // vertically center inside the pill (same constant as invoice-pdf).
        pdf.text(
          label,
          bx + (bw - tw) / 2,
          by + bh / 2 + fontSizePt * 0.35 * 0.352778,
        );
        pdf.link(bx, by, bw, bh, { url: invoiceRaster.upiUrl });
      }

      // Clickable payment link annotation over the QR — viewers that hand
      // custom URI schemes to the OS open the customer's UPI app.
      if (invoiceRaster.qr && invoiceRaster.upiUrl) {
        pdf.link(
          invoiceRaster.qr.x * mmPerPx,
          invoiceRaster.qr.y * mmPerPx,
          invoiceRaster.qr.w * mmPerPx,
          invoiceRaster.qr.h * mmPerPx,
          { url: invoiceRaster.upiUrl },
        );
      }
    };

    // Rasterize each .page element to a canvas, add to PDF as one page each.
    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i];
      // Splice the pre-rasterized invoice page in at its slot, just before
      // the job page that follows it (also appended after the loop when the
      // invoice is the final page).
      if (invoiceRaster && i === invoiceIndex) {
        onProgress?.(i, finalPageCount, "Rendering invoice page…");
        await nextPaint();
        addInvoicePage();
      }
      // Label each page for the progress indicator. Cover is index 0; the
      // interleaved middle pages (material + style per garment) each have a
      // precomputed label; every page from `invoiceStart` on is a body
      // measurements page. `finalIndex` accounts for the invoice page
      // shifting later pages by one (pageEls omits the invoice element).
      const finalIndex = invoiceRaster && i >= invoiceIndex ? i + 1 : i;
      const label =
        i === 0
          ? "Cover page"
          : i <= middleLabels.length
            ? middleLabels[i - 1] ?? "page"
            : `Body measurements page ${finalIndex - bodyStart + 2}`;
      onProgress?.(finalIndex, finalPageCount, `Rendering ${label}…`);

      // Allow the browser to paint the progress update before the
      // (synchronous, heavy) html2canvas call blocks the main thread.
      await nextPaint();

      const canvas = await html2canvas(el, {
        scale: 3, // 3x for crisp output (~216 DPI)
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        // Confine rasterization to this element's bounds.
        width: el.offsetWidth,
        height: el.offsetHeight,
        windowWidth: 794,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      // Fit the canvas into the A4 page preserving aspect ratio.
      const imgW = pageWidthMm;
      const imgH = (canvas.height * imgW) / canvas.width;
      if (i === 0) {
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, Math.min(imgH, pageHeightMm));

        // Overlay a REAL clickable link annotation over the "Listen to
        // recording" button. The rasterized JPEG has no links; jsPDF's
        // link() adds a transparent clickable region at mm coordinates,
        // so the button works in any digital PDF viewer. We map the
        // button's DOM rect (relative to the cover .page) into PDF mm
        // using the same px→mm scale as the image (pageWidthMm / 794).
        const btn = el.querySelector<HTMLElement>(".voice-note-btn");
        if (btn && voiceNote?.url) {
          const pageRect = el.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          const pxPerMm = 794 / pageWidthMm;
          const linkXmm = (btnRect.left - pageRect.left) / pxPerMm;
          const linkWmm = btnRect.width / pxPerMm;
          // PDF y grows downward from the top, same as the DOM rect here.
          const linkYmm = (btnRect.top - pageRect.top) / pxPerMm;
          const linkHmm = btnRect.height / pxPerMm;
          try {
            pdf.link(linkXmm, linkYmm, linkWmm, linkHmm, {
              url: voiceNote.url,
            });
          } catch (err) {
            console.warn(
              "[job-pdf] failed to attach voice-note link annotation:",
              err,
            );
          }
        }
      } else {
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, Math.min(imgH, pageHeightMm));
      }
    }

    // Invoice as the FINAL page (body measurements disabled) — append it now.
    if (invoiceRaster && invoiceIndex >= pageEls.length) addInvoicePage();

    onProgress?.(finalPageCount, finalPageCount, "Saving file…");
    await nextPaint();

    const custSlug = nameSlug(customer?.name);
    const namePart = custSlug ? `-${custSlug}` : "";
    const filename = `DRAEP-Measurement${namePart}-${(job.id ?? "report").slice(0, 8)}.pdf`;
    const blob = pdf.output("blob");
    saveAs(blob, filename);
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────

/** Yield to the browser so it can paint pending UI updates. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    // Double rAF: first schedules the paint, second fires after the paint.
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Resolve once every <img> under `root` has fired load OR error (with timeout). */
function waitForImages(root: HTMLElement, timeoutMs = 8000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        Promise.race([
          new Promise<void>((resolve) => {
            if (img.complete && img.naturalWidth > 0) return resolve();
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
          new Promise<void>((resolve) => setTimeout(() => resolve(), timeoutMs)),
        ]),
    ),
  ).then(() => undefined);
}

/**
 * Replace every `[data-pdf-src]` <img> with a <canvas> that already has the
 * image drawn onto it.
 *
 * Why a canvas replacement (not just data-URL swap):
 *   html2canvas has a long history of silently dropping <img> elements whose
 *   source is cross-origin, even when CORS headers are present, even when the
 *   src is swapped to a data: URL — the library's internal image-loader cache
 *   key includes the crossOrigin attribute and taint flag, and any mismatch
 *   produces a blank slot in the output. This was the actual cause of the
 *   material photo disappearing from the last page.
 *
 *   <canvas> elements, by contrast, are rendered by html2canvas via a direct
 *   drawImage() copy of the canvas bitmap — no network fetch, no CORS check,
 *   no taint. We load the image ourselves via fetch+blob+objectURL (which
 *   avoids the cross-origin <img> taint entirely), draw it onto a canvas at
 *   the target display size, and replace the <img> in the DOM. The result is
 *   pixel-identical to a properly-rendered <img> but immune to html2canvas's
 *   image-loading quirks.
 *
 * Images that fail to load leave the original <img> in place so a
 * broken-image box is still visible in the output.
 */
async function inlineImagesAsCanvases(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-pdf-src]"));
  if (imgs.length === 0) return;

  // Cache the decoded HTMLImageElement per URL so repeated images reuse it.
  const urlToHtmlImage = new Map<string, HTMLImageElement>();

  // Collect unique URLs.
  const uniqueUrls: string[] = [];
  for (const img of imgs) {
    const raw = img.getAttribute("data-pdf-src");
    if (!raw) continue;
    const abs = absUrl(raw);
    if (abs && !urlToHtmlImage.has(abs)) {
      uniqueUrls.push(abs);
      urlToHtmlImage.set(abs, undefined as unknown as HTMLImageElement);
    }
  }

  // Decode each unique URL into an off-DOM HTMLImageElement sourced from a
  // blob URL (same-origin, no taint).
  await Promise.all(
    uniqueUrls.map(async (abs) => {
      try {
        // Timeout after 8s so a hung fetch doesn't block the whole PDF.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(abs, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn(`[job-pdf] image fetch returned ${res.status} for ${abs}`);
          return;
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        try {
          const decoded = await new Promise<HTMLImageElement>((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = (e) => reject(e);
            // No crossOrigin — the blob: URL is same-origin already.
            im.src = objectUrl;
          });
          urlToHtmlImage.set(abs, decoded);
        } finally {
          // The decoded HTMLImageElement retains its bitmap; we can release
          // the object URL now.
          URL.revokeObjectURL(objectUrl);
        }
      } catch (err) {
        console.warn(`[job-pdf] image decode failed for ${abs}:`, err);
      }
    }),
  );

  // Replace each <img> in the DOM with a <canvas> at the same display size.
  for (const img of imgs) {
    const raw = img.getAttribute("data-pdf-src");
    if (!raw) continue;
    const abs = absUrl(raw);
    const decoded = abs ? urlToHtmlImage.get(abs) : undefined;
    if (!decoded) continue;

    // Determine the target display size from computed style so the canvas
    // fills the same box the <img> was occupying.
    const computed = window.getComputedStyle(img);
    // `object-fit` decides whether we crop-to-fill (cover) or preserve the
    // whole image (contain / auto). For the large metric guide photos we use
    // natural-aspect sizing (height: auto) — the rendered box already matches
    // the image aspect, so we must NOT crop. For fixed-square photo grids
    // (object-fit: cover) we keep the cover crop.
    const objectFit = computed.objectFit;
    const useCover = objectFit === "cover";
    const naturalAspect = decoded.naturalWidth / decoded.naturalHeight;

    let targetW = parseInt(computed.width, 10) || decoded.naturalWidth;
    let targetH = parseInt(computed.height, 10) || decoded.naturalHeight;
    if (!useCover) {
      // Honor the image's true aspect ratio: derive height from the rendered
      // width so the canvas matches the image exactly (no stretch, no crop).
      // Respect the CSS max-height cap if present.
      let h = targetW / naturalAspect;
      const maxH = parseInt(computed.maxHeight, 10);
      if (Number.isFinite(maxH) && maxH > 0 && h > maxH) {
        h = maxH;
        targetW = h * naturalAspect; // shrink width to keep aspect at the cap
      }
      targetH = h;
    }

    const canvas = document.createElement("canvas");
    // 3x for crisp PDF output at the same display size.
    canvas.width = Math.max(1, Math.round(targetW)) * 3;
    canvas.height = Math.max(1, Math.round(targetH)) * 3;
    canvas.style.width = `${Math.round(targetW)}px`;
    canvas.style.height = `${Math.round(targetH)}px`;
    canvas.style.display = img.style.display || "block";
    canvas.style.borderRadius = computed.borderRadius;
    canvas.style.border = computed.border;
    canvas.style.objectFit = useCover ? "cover" : "contain";
    canvas.style.background = computed.background;

    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(3, 3);
    if (useCover) {
      // Cover semantics — fill the fixed box, cropping the overflow.
      const boxAspect = targetW / targetH;
      let sx = 0, sy = 0, sw = decoded.naturalWidth, sh = decoded.naturalHeight;
      if (naturalAspect > boxAspect) {
        sw = decoded.naturalHeight * boxAspect;
        sx = (decoded.naturalWidth - sw) / 2;
      } else if (naturalAspect < boxAspect) {
        sh = decoded.naturalWidth / boxAspect;
        sy = (decoded.naturalHeight - sh) / 2;
      }
      ctx.drawImage(decoded, sx, sy, sw, sh, 0, 0, targetW, targetH);
    } else {
      // Contain / natural aspect — draw the WHOLE image, no crop.
      ctx.drawImage(decoded, 0, 0, targetW, targetH);
    }

    // Preserve any classes (e.g., layout rules) and replace.
    canvas.className = img.className;
    canvas.setAttribute("data-pdf-replaced", "canvas");
    img.replaceWith(canvas);
  }
}

// ─── Print CSS (A4 portrait, multi-page, 4 metrics per body page) ─────────
//
// Note: this stylesheet serves BOTH the html2canvas pipeline (rendered as a
// regular screen-DOM element) and a fallback browser-print path. Each `.page`
// is given a fixed pixel width (794px = 210mm at 96 DPI) and min-height
// (1123px = 297mm) so html2canvas captures a consistent A4 portrait frame.

const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans",
                 "Noto Sans Devanagari", "Noto Sans Kannada", Roboto, Arial, sans-serif;
    color: #0f172a;
    font-size: 11pt;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 794px;          /* 210mm at 96 DPI */
    min-height: 1123px;    /* 297mm at 96 DPI — full A4 portrait */
    padding: 60px 53px 68px 53px; /* 16mm/14mm/18mm/14mm in px @ 96 DPI */
    background: #ffffff;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }

  /* Brand header (cover) */
  .brand-header {
    border-bottom: 3px solid #0f172a;
    padding-bottom: 10pt;
    margin-bottom: 24pt;
  }
  .brand-header h1 {
    font-size: 28pt;
    letter-spacing: 6pt;
    margin: 0;
    font-weight: 800;
  }
  .brand-header .subtitle {
    font-size: 12pt;
    color: #475569;
    margin-top: 2pt;
  }

  /* Cover grid */
  .cover-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24pt;
    margin-bottom: 24pt;
  }
  .cover-block h2,
  .page-header h2 {
    font-size: 13pt;
    font-weight: 700;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 1pt;
    color: #0f172a;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 4pt;
    margin: 0 0 10pt 0;
  }
  table.kv {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
  }
  table.kv th {
    text-align: left;
    width: 40%;
    color: #64748b;
    font-weight: 500;
    padding: 4pt 6pt 4pt 0;
    vertical-align: top;
  }
  table.kv td {
    padding: 4pt 0;
    color: #0f172a;
    vertical-align: top;
  }

  .notes-block { margin-top: 8pt; }
  .notes-body {
    border: 1px solid #e2e8f0;
    border-radius: 4pt;
    padding: 10pt;
    min-height: 60pt;
    white-space: pre-wrap;
    font-size: 10.5pt;
  }
  .address-body {
    border: 1px solid #e2e8f0;
    border-radius: 4pt;
    padding: 8pt 10pt;
    font-size: 10.5pt;
    line-height: 1.5;
    color: #0f172a;
  }

  /* Voice-note CTA on the cover page. Renders only when a voice note URL
     was recorded. The PDF is rasterized to JPEG, so links aren't clickable —
     the QR code is the tailor's way to open the audio on their phone. */
  .voice-note-cta {
    display: flex;
    align-items: flex-start;
    gap: 18pt;
    margin: 0 0 20pt 0;
    padding: 16pt 20pt;
    border: 1px solid #cbd5e1;
    border-left: 4pt solid #0f172a;
    border-radius: 6pt;
    background: #f8fafc;
  }
  .voice-note-copy { flex: 1 1 auto; min-width: 0; }
  .voice-note-qr {
    flex: 0 0 auto;
    width: 120pt;
    height: 120pt;
    padding: 6pt;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4pt;
  }
  .voice-note-qr img { width: 100%; height: 100%; object-fit: contain; }
  .voice-note-copy h2 {
    margin: 0 0 6pt 0;
    font-size: 14pt;
    color: #0f172a;
    border: none;
    padding: 0;
  }
  .voice-note-copy p {
    margin: 0 0 4pt 0;
    font-size: 11pt;
    color: #334155;
    line-height: 1.45;
  }
  .voice-note-copy .voice-note-instr {
    font-size: 10pt;
    color: #64748b;
    font-style: italic;
  }
  /* "Listen to recording" button. In the rasterized PDF the <a> is overlaid
     by a real PDF link annotation (see the jsPDF loop), so it stays clickable
     in digital viewers; in print it reads as an obvious call-to-action. */
  .voice-note-btn {
    display: inline-flex;
    align-items: center;
    gap: 8pt;
    margin-top: 10pt;
    padding: 9pt 20pt;
    border: none;
    border-radius: 999pt;
    background: #0f172a;
    color: #ffffff;
    font-size: 11.5pt;
    font-weight: 600;
    text-decoration: none;
    line-height: 1;
  }
  .voice-note-btn-icon {
    font-size: 10pt;
    line-height: 1;
  }

  /* Section pages (garment + body) — header row on every page */
  .body-page .page-header,
  .garment-page .page-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14pt;
  }
  .page-num {
    font-size: 9pt;
    color: #64748b;
  }

  /* Garment sections — cloth & materials (2.4) */
  .materials-list {
    display: flex;
    flex-direction: column;
    gap: 14pt;
  }
  .material-card {
    border: 1px solid #e2e8f0;
    border-radius: 8pt;
    padding: 12pt;
    background: #ffffff;
    break-inside: avoid;
  }
  .material-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8pt;
    margin-bottom: 10pt;
    font-size: 10.5pt;
  }
  .meta-pill {
    display: inline-block;
    padding: 3pt 10pt;
    background: #0f172a;
    color: #ffffff;
    font-size: 8.5pt;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    font-weight: 600;
    white-space: nowrap;
    /* Square corners + generous padding (NOT border-radius:999pt): html2canvas
       under-paints the background of inline-block pills with padding, clipping
       the right edge of the text. A square box with ample horizontal padding
       leaves enough background on all sides to cover the text reliably. */
    letter-spacing: 0;
    border-radius: 2pt;
  }
  .meta-name {
    font-weight: 700;
    color: #0f172a;
    font-size: 12pt;
  }
  .meta-dim {
    color: #475569;
    font-size: 10pt;
    margin-left: auto;
  }
  .material-comment {
    margin: 0 0 10pt 0;
    padding: 8pt 10pt;
    background: #f8fafc;
    border-left: 3px solid #94a3b8;
    border-radius: 0 4pt 4pt 0;
    font-size: 10pt;
    color: #1e293b;
    white-space: pre-wrap;
  }

  /* BIG color banner — the prominent color block the user asked for. */
  .color-banner {
    width: 100%;
    height: 90pt;            /* biggg box */
    border-radius: 6pt;
    border: 1px solid rgba(0,0,0,0.08);
    display: flex;
    align-items: flex-end;
    justify-content: flex-start;
    padding: 10pt 14pt;
    margin: 4pt 0 10pt 0;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
    position: relative;
    overflow: hidden;
  }
  .color-banner-empty {
    background: repeating-linear-gradient(
      45deg,
      #f1f5f9,
      #f1f5f9 10px,
      #e2e8f0 10px,
      #e2e8f0 20px
    ) !important;
    color: #64748b;
  }
  .color-banner-label {
    font-size: 11pt;
    font-weight: 700;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 1.2pt;
    color: #ffffff;
    background: rgba(0,0,0,0.55);
    padding: 4pt 10pt;
    border-radius: 4pt;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }
  .color-banner-empty .color-banner-label {
    color: #475569;
    background: rgba(255,255,255,0.7);
    text-shadow: none;
  }

  .photo-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8pt;
    /* flex-start so a tall photo's row-mates don't stretch to match it. */
    align-items: flex-start;
  }
  .photo-grid img,
  .photo-grid canvas {
    /* Fixed pixel width - html2canvas (older CSS engine) handles explicit
       px sizes much more reliably than aspect-ratio or grid auto-rows.
       Natural-aspect sizing (height: auto + a max-height cap) renders the
       COMPLETE image — no square cover-crop — and inlineImagesAsCanvases()
       pre-rasterizes each canvas at exactly this box. */
    width: 200px;
    height: auto;
    max-height: 240px;
    object-fit: contain;
    border-radius: 6pt;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    display: block;
  }
  .photo-grid-empty {
    padding: 14pt;
    border: 1px dashed #cbd5e1;
    border-radius: 6pt;
    color: #94a3b8;
    font-size: 10pt;
    text-align: center;
    font-style: italic;
  }

  .user-note {
    margin-top: 8pt;
    padding: 8pt 10pt;
    background: #f8fafc;
    border-left: 3px solid #0f172a;
    font-size: 10pt;
    border-radius: 0 4pt 4pt 0;
  }
  .muted { color: #94a3b8; font-style: italic; }

  .report-footer {
    margin-top: auto;
    padding-top: 10pt;
    border-top: 1px solid #e2e8f0;
    font-size: 8.5pt;
    color: #94a3b8;
    text-align: center;
  }

  /* ─── Garment section chrome: hero banner + subsection labels ──────── */

  /* Hero banner: garment name big, with GO id / status / counts beneath. */
  .style-hero {
    border: 1px solid #e2e8f0;
    border-left: 5pt solid #0f172a;
    border-radius: 8pt;
    padding: 14pt 16pt;
    margin-bottom: 16pt;
    background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
  }
  .style-hero-label {
    font-size: 18pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 0.3pt;
    margin-bottom: 6pt;
    line-height: 1.2;
  }
  .style-hero-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10pt;
    font-size: 9.5pt;
    color: #64748b;
  }
  .style-hero-status {
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    font-weight: 600;
    color: #0f172a;
    background: #e2e8f0;
    padding: 3pt 10pt;
    /* Square corners (NOT border-radius:999pt): html2canvas under-paints the
       background of inline-block pills with padding, clipping the text. Same
       fix as .meta-pill / .gs-addon-badge. */
    border-radius: 2pt;
    font-size: 8.5pt;
    white-space: nowrap;
    letter-spacing: 0;
  }
  .style-hero-counts { color: #94a3b8; }

  /* Section label above the spec grid. */
  .style-section-label {
    font-size: 9pt;
    font-weight: 700;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 1pt;
    color: #475569;
    margin: 4pt 0 10pt 0;
    padding-bottom: 4pt;
    border-bottom: 1px solid #e2e8f0;
  }

  /* ─── Garment section tables (2.1 style selections · 2.3 measurements) ──
     Same html2canvas constraints as everywhere below: real <table> layout
     (no CSS grid), no text-transform (uppercase at source via upper()),
     explicit sizes. The 12pt margin-bottom is exactly what GS_TABLE_MARGIN
     budgets per rendered page — never change it in isolation. */
  .gs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
    margin: 0 0 12pt 0;
  }
  .gs-table thead th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 600;
    letter-spacing: 0.8pt;
    font-size: 9pt;
    text-align: left;
    padding: 6pt 8pt;
    border-bottom: 1px solid #cbd5e1;
  }
  .gs-table tbody td {
    padding: 7pt 8pt;
    border-bottom: 1px solid #e2e8f0;
    color: #0f172a;
    vertical-align: top;
  }

  /* Column widths. 2.1: Titles | Selected Titles | Selected Descriptions. */
  .gs-th-title, .gs-td-title { width: 26%; }
  .gs-th-choice, .gs-td-choice { width: 32%; }
  .gs-th-desc, .gs-td-desc { width: 42%; }
  /* 2.3 rails: fixed image + value columns, description takes the rest. */
  .gs-th-img, .gs-td-img { width: 118px; }
  .gs-th-value, .gs-td-value { width: 96px; text-align: center; }

  /* Titles cell: component / selection name + native names + one-line blurb. */
  .gs-comp {
    font-size: 11pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
    word-break: break-word;
  }
  .gs-native {
    font-size: 9pt;
    color: #64748b;
    line-height: 1.4;
    margin-top: 1pt;
  }
  .gs-comp-desc {
    font-size: 8.5pt;
    color: #94a3b8;
    line-height: 1.4;
    margin-top: 2pt;
  }
  .gs-addon-badge {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 700;
    color: #ffffff;
    background: #6d28d9;
    /* Explicit width + square corners + content-box: html2canvas
       under-paints inline-block pill backgrounds and clips the text (same
       fix as .meta-pill / .style-hero-status). */
    padding: 3pt 14pt;
    width: 46pt;
    text-align: center;
    letter-spacing: 0;
    box-sizing: content-box;
    border-radius: 3pt;
    white-space: nowrap;
    margin-top: 4pt;
  }

  /* Selected-titles cell: the chosen variation + price / placement. */
  .gs-choice {
    font-size: 11.5pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
    word-break: break-word;
  }
  .gs-price {
    font-size: 9.5pt;
    font-weight: 700;
    color: #0f172a;
    margin-top: 2pt;
    font-variant-numeric: tabular-nums;
  }
  .gs-placement {
    font-size: 8.5pt;
    color: #64748b;
    font-style: italic;
    margin-top: 2pt;
  }

  /* One description line per language (English first) — the script itself
     signals the language, so no tag prefix. */
  .gs-desc-line {
    font-size: 8.5pt;
    color: #64748b;
    line-height: 1.5;
    margin-top: 3pt;
  }
  .gs-desc-line:first-child { margin-top: 0; }

  /* 2.3 measurement image rail (canvases = pre-rasterized by
     inlineImagesAsCanvases before html2canvas runs). */
  .gs-td-img img,
  .gs-td-img canvas {
    width: 104px;
    height: auto;
    max-height: 118px;
    object-fit: contain;
    border-radius: 4pt;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    display: block;
  }
  .gs-img-placeholder {
    width: 104px;
    height: 74px;
    border: 1px dashed #cbd5e1;
    border-radius: 4pt;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    color: #94a3b8;
    text-align: center;
  }

  /* Big value cell — the number a tailor reads across the room. */
  .gs-mval {
    font-size: 24pt;
    font-weight: 800;
    color: #0f172a;
    line-height: 1;
  }
  .gs-mval-unit {
    font-size: 9.5pt;
    font-weight: 600;
    color: #64748b;
    margin-top: 2pt;
  }
  .gs-mval-empty {
    font-size: 14pt;
    font-weight: 600;
    color: #94a3b8;
  }
  .gs-mval-text {
    font-size: 12pt;
    font-weight: 700;
    color: #0f172a;
    word-break: break-word;
  }

  /* 2.2 inspiration disclaimer — amber so it reads as a caution, not spec. */
  .gs-note {
    border: 1px solid #fde68a;
    border-left: 4pt solid #f59e0b;
    background: #fffbeb;
    color: #92400e;
    font-size: 9.5pt;
    line-height: 1.5;
    padding: 8pt 10pt;
    border-radius: 0 4pt 4pt 0;
    margin: 0 0 10pt 0;
  }
`;
