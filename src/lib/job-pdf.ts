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
 * Layout (multi-page via CSS `page-break` rules):
 *   Page 1 — Cover: order, customer, job notes
 *   Then, interleaved per garment order: its materials page (cloth, colors,
 *   photos, garment measurements) followed by its style selections page
 *   Then — the embedded tax invoice (reuses the invoice-pdf.ts template;
 *   see `JobPdfInput.invoice`), then the body-measurement guide pages
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

/** A garment order paired with its design items, for the PDF style pages. */
export interface StyleSelectionGroup {
  garmentOrder: GarmentOrderRow;
  /** A display label for the garment (resolved by the caller). */
  garmentLabel: string;
  basePrice: number | null;
  items: GarmentOrderItemRow[];
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
 *   measurementDetails → the Body Measurements pages
 *   designDetails      → the Style Selections pages
 *   fabricDetails      → the Garment Details pages
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

/** Format a reading value, falling back to "—" when missing. */
function fmtValue(
  reading: BodyMeasurementWithMetric["reading"],
  metric: BodyMeasurementWithMetric["metric"],
): string {
  if (!reading) return "—";
  if (reading.value_numeric !== null && reading.value_numeric !== undefined) {
    const u = reading.unit ?? metric.unit ?? "";
    return `${reading.value_numeric}${u ? ` ${u}` : ""}`;
  }
  if (reading.value_text) return esc(reading.value_text);
  return "—";
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

/** One body-measurement per page — large image so a tailor can read it clearly. */
function bodyMeasurementsPage(
  rows: BodyMeasurementWithMetric[],
  pageNum: number,
  totalPages: number,
): string {
  const blocks = rows
    .map(({ metric, reading }, idx) => {
      const labels = metric.labels ?? {};
      const descriptions = metric.descriptions ?? {};
      const imageUrl = absUrl(metric.asset_urls?.[0] ?? null);

      return `
        <div class="metric-row">
          <div class="metric-image">
            ${
              imageUrl
                ? `<img src="${imageUrl}"
                        data-pdf-src="${esc(metric.asset_urls?.[0] ?? "")}"
                        alt="${esc(labels.en ?? metric.code ?? "metric")}" />`
                : `<div class="img-placeholder">No image</div>`
            }
          </div>
          <div class="metric-body">
            <div class="metric-headline">
              <div class="metric-names">
                <div class="name name-en">${esc(labels.en ?? metric.code ?? "—")}</div>
                ${labels.hi ? `<div class="name name-hi">${esc(labels.hi)}</div>` : ""}
                ${labels.kn ? `<div class="name name-kn">${esc(labels.kn)}</div>` : ""}
              </div>
              <div class="metric-value">
                <div class="value-label">${upper("Value")}</div>
                <div class="value-text">${fmtValue(reading, metric)}</div>
              </div>
            </div>
            <div class="metric-desc">
              ${descriptions.en ? `<div>${esc(descriptions.en)}</div>` : ""}
              ${descriptions.hi ? `<div class="desc-hi">${esc(descriptions.hi)}</div>` : ""}
              ${descriptions.kn ? `<div class="desc-kn">${esc(descriptions.kn)}</div>` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="page body-page">
      <header class="page-header">
        <h2>Body Measurements</h2>
        <div class="page-num">Page ${pageNum} of ${totalPages}</div>
      </header>
      ${blocks}
      <footer class="report-footer">DRAEP Measurement Report • Page ${pageNum} of ${totalPages}</footer>
    </section>
  `;
}

function garmentDetailsPages(
  groups: GarmentMeasurementGroup[],
  startPageNum: number,
  totalPageCount: number,
): string {
  // Empty (or fully deselected) garment list → no pages at all, matching the
  // pagination math in downloadMeasurementJobPdf (one page per group, 0 when
  // empty). The caller's page-count/footer numbers rely on this exact contract.
  if (groups.length === 0) return "";

  let pageNum = startPageNum;
  return groups
    .map((g) => {
      const garmentName =
        g.garmentLabels?.en ?? g.garmentSlug ?? "Garment";
      const garmentNameHi = g.garmentLabels?.hi;
      const garmentNameKn = g.garmentLabels?.kn;

      // Each material is its own card with a big color banner and a photo grid.
      const materialCards = g.materials
        .map((m) => {
          const dims =
            m.length !== null || m.breadth !== null
              ? `${m.length ?? "—"} × ${m.breadth ?? "—"}${m.unit ? ` ${m.unit}` : ""}`
              : null;

          // Big, prominent color block — full-width banner.
          const colorBlock = m.color
            ? `<div class="color-banner" style="background:${esc(m.color)};">
                 <span class="color-banner-label">${esc(m.color)}</span>
               </div>`
            : `<div class="color-banner color-banner-empty">
                 <span class="color-banner-label">No color recorded</span>
               </div>`;

          // Material photos — use data-pdf-src marker so we can inline them
          // as pre-rasterized <canvas> before html2canvas runs (avoids any
          // html2canvas image-loader quirks). Same-origin via Next.js proxy.
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

          const metaRow = `
            <div class="material-meta">
              ${m.type ? `<span class="meta-pill">${upper(m.type)}</span>` : ""}
              ${m.name ? `<span class="meta-name">${esc(m.name)}</span>` : ""}
              ${dims ? `<span class="meta-dim">Dimensions: ${esc(dims)}</span>` : ""}
            </div>
          `;

          const commentBlock = m.comment
            ? `<div class="material-comment">${esc(m.comment)}</div>`
            : "";

          return `
            <div class="material-card">
              ${metaRow}
              ${colorBlock}
              ${commentBlock}
              ${photoGrid}
            </div>
          `;
        })
        .join("");

      const currentPageNum = pageNum++;

      // This garment instance's own (garment-scoped) readings — compact list.
      const readingsRows = (g.readings ?? [])
        .filter((r) => r.reading)
        .map(
          (r) => `
            <tr>
              <td>${esc(r.metric.labels?.en ?? r.metric.code ?? "—")}</td>
              <td class="mono">${esc(fmtValue(r.reading, r.metric))}</td>
            </tr>
          `,
        )
        .join("");
      const readingsBlock = readingsRows
        ? `
          <div class="garment-readings">
            <h3 class="block-title">${upper("Garment measurements")}</h3>
            <table class="readings-table">
              <tbody>${readingsRows}</tbody>
            </table>
          </div>
        `
        : "";

      return `
        <section class="page garment-page">
          <header class="page-header">
            <h2>${upper("Garment")}: ${esc(garmentName)}</h2>
            <div class="page-num">Page ${currentPageNum} of ${totalPageCount}</div>
          </header>

          <div class="garment-names">
            ${garmentNameHi ? `<div class="name name-hi">${esc(garmentNameHi)}</div>` : ""}
            ${garmentNameKn ? `<div class="name name-kn">${esc(garmentNameKn)}</div>` : ""}
          </div>

          ${readingsBlock}

          ${
            g.materials.length > 0
              ? `<div class="materials-list">${materialCards}</div>`
              : `<p class="muted">No cloth / addon materials captured.</p>`
          }

          ${
            g.userNote
              ? `<div class="user-note"><strong>Customer note:</strong> ${esc(g.userNote)}</div>`
              : ""
          }

          <footer class="report-footer">DRAEP Measurement Report • Page ${currentPageNum} of ${totalPageCount}</footer>
        </section>
      `;
    })
    .join("");
}

// ─── Style selections (component → variation → variation_type, add-ons) ────

/**
 * Build one or more "Style Selections" pages — one per garment order.
 *
 * Each page shows:
 *   - Garment name + GO ID + base price
 *   - Component-style selections (type=variation), one row each
 *   - Add-on selections (type=add_on), one row each, with placement
 *   - Computed total (base + items)
 *
 * The page re-uses the existing `.garment-page` / `.material-card` /
 * `.kv` styles for visual consistency with the rest of the report.
 */
function styleSelectionsPages(
  groups: StyleSelectionGroup[],
  startPageNum: number,
  totalPageCount: number,
): string {
  if (groups.length === 0) return "";

  let pageNum = startPageNum;
  return groups
    .map((g) => {
      const variations = g.items.filter((it) => it.type === "variation");
      const addons = g.items.filter((it) => it.type === "add_on");

      // Split each variation label on " → " into a component + choice, so we
      // can render a clean component→choice chip instead of a flat table row.
      // e.g. "Blouse cut → Princess cut" → component "Blouse cut", choice "Princess cut".
      const splitLabel = (label: string): { component: string | null; choice: string } => {
        const i = label.indexOf("→");
        if (i < 0) return { component: null, choice: label };
        return { component: label.slice(0, i).trim(), choice: label.slice(i + 1).trim() };
      };

      const variationCards = variations.map((it) => {
        const { component, choice } = splitLabel(itemLabelText(it));
        const placement = placementText(it.placement);
        return `
          <div class="spec-chip">
            <div class="spec-chip-head">
              <span class="spec-chip-component">${upper(component ?? "Selection")}</span>
            </div>
            <div class="spec-chip-choice">${esc(choice || "—")}</div>
            ${placement ? `<div class="spec-chip-placement">${esc(placement)}</div>` : ""}
          </div>
        `;
      });

      const addonCards = addons.map((it) => {
        const { component, choice } = splitLabel(itemLabelText(it));
        const placement = placementText(it.placement);
        return `
          <div class="spec-chip spec-chip-addon">
            <div class="spec-chip-head">
              <span class="spec-chip-component">${upper(component ?? "Add-on")}</span>
              <span class="spec-chip-badge">${upper("Add-on")}</span>
            </div>
            <div class="spec-chip-choice">${esc(choice || "—")}</div>
            ${placement ? `<div class="spec-chip-placement">${esc(placement)}</div>` : ""}
          </div>
        `;
      });

      // Pair all chips into table rows of 2 (variation cards first, then
      // add-ons). Using a table (not CSS grid) because html2canvas renders
      // table columns reliably while grid `1fr` columns overflow their cell.
      const allCards = [...variationCards, ...addonCards];
      const hasAny = allCards.length > 0;
      const rowsHtml: string[] = [];
      for (let i = 0; i < allCards.length; i += 2) {
        const left = allCards[i] ?? "";
        const right = allCards[i + 1] ?? "";
        rowsHtml.push(`
          <div class="spec-grid-row">
            <div class="spec-cell">${left}</div>
            <div class="spec-cell">${right}</div>
          </div>
        `);
      }
      const selectionsHtml = hasAny
        ? `<div class="spec-grid">${rowsHtml.join("")}</div>`
        : `<p class="muted">No style selections recorded for this garment order.</p>`;

      const countsLine = [
        variations.length > 0 ? `${variations.length} selection${variations.length > 1 ? "s" : ""}` : null,
        addons.length > 0 ? `${addons.length} add-on${addons.length > 1 ? "s" : ""}` : null,
      ].filter(Boolean).join(" · ");

      const userNote = g.garmentOrder.user_note
        ? `<div class="user-note"><strong>Customer note:</strong> ${esc(g.garmentOrder.user_note)}</div>`
        : "";

      // Customer-uploaded design-inspiration photos for this garment order.
      // Uses data-pdf-src so inlineImagesAsCanvases() pre-rasterizes each
      // image (same pattern as the material photos in garmentDetailsPages).
      const assetsShared = (g.assetsShared ?? [])
        .map((u) => (typeof u === "string" ? u : null))
        .filter((u): u is string => Boolean(u));
      const assetsBlock = assetsShared.length > 0
        ? `<div class="style-photos">
             <div class="style-photos-label">${upper("Design Inspiration")} (${assetsShared.length})</div>
             <div class="photo-grid">
               ${assetsShared
                 .map(
                   (u) =>
                     `<img src="${absUrl(u)}"
                            data-pdf-src="${esc(u)}"
                            alt="${esc(g.garmentLabel)} design inspiration" />`,
                 )
                 .join("")}
             </div>
           </div>`
        : "";

      const currentPageNum = pageNum++;
      return `
        <section class="page garment-page style-page">
          <header class="page-header">
            <h2>${upper("Style Selections")}</h2>
            <div class="page-num">Page ${currentPageNum} of ${totalPageCount}</div>
          </header>

          <div class="style-hero">
            <div class="style-hero-label">${esc(g.garmentLabel)}</div>
            <div class="style-hero-meta">
              <span>GO ${esc(g.garmentOrder.id.slice(0, 8))}</span>
              ${g.garmentOrder.status ? `<span class="style-hero-status">${upper(g.garmentOrder.status.replace(/_/g, " "))}</span>` : ""}
              ${countsLine ? `<span class="style-hero-counts">${esc(countsLine)}</span>` : ""}
            </div>
          </div>

          ${assetsBlock}

          <div class="style-section-label">${upper("Design selections")}</div>
          ${selectionsHtml}

          ${userNote}

          <footer class="report-footer">DRAEP Measurement Report • Page ${currentPageNum} of ${totalPageCount}</footer>
        </section>
      `;
    })
    .join("");
}

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
  // content section is gated by its toggle in `opts`. Page order interleaves
  // per garment — everything about one garment before the next:
  //   1 cover  →  [garment N materials → garment N style selections]…
  //            →  invoice  →  body measurements
  // (Body measurements come LAST: a tailor reads the spec pages first, then
  //  the per-measurement guide pages.)
  const bodyPerPage = 1;
  const styleGroups = styleSelections ?? [];

  // A disabled section contributes 0 pages; an enabled one contributes its
  // natural page count. Garment/style sections emit one page per group and
  // NOTHING when the group list is empty — an order with no garments, or one
  // whose garments were all deselected by the caller, gets no garment/style
  // pages (the builders return "" for an empty list to match this math).
  const garmentPages = opts.fabricDetails ? garmentMeasurements.length : 0;
  const stylePages = opts.designDetails ? styleGroups.length : 0;
  const bodyPages = opts.measurementDetails
    ? Math.max(1, Math.ceil(bodyMeasurements.length / bodyPerPage))
    : 0;
  const invoicePages = opts.invoice && invoice ? 1 : 0;

  const totalPages =
    1 /* cover */ + garmentPages + stylePages + invoicePages + bodyPages;

  // Page-number offsets (cover is page 1). The garment/style middle pages
  // interleave, but their combined count is still garmentPages + stylePages,
  // so the invoice and body sections start right after them either way.
  const invoiceStart = 2 + garmentPages + stylePages;
  const bodyStart = invoiceStart + invoicePages;

  // Interleave the middle pages per garment: the garment's material page,
  // then that same garment's style page. Style groups pair with measurement
  // groups by garment order id — both arrays come from the same filtered
  // rows on the admin page, so they always match 1:1; any unmatched style
  // group (defensive) appends after the interleaved run. Each builder gets
  // a single-group array so IT stamps that page's number; the pageNum
  // counter stays sequential across the interleaved order.
  const styleByGoId = new Map(styleGroups.map((sg) => [sg.garmentOrder.id, sg]));
  const middleSections: string[] = [];
  const middleLabels: string[] = [];
  let pageNum = 2;
  for (const g of garmentMeasurements) {
    if (opts.fabricDetails) {
      middleSections.push(garmentDetailsPages([g], pageNum, totalPages));
      middleLabels.push(
        `Garment details — ${g.garmentLabels?.en ?? g.garmentSlug ?? "Garment"}`,
      );
      pageNum++;
    }
    const sg = styleByGoId.get(g.garmentOrderId);
    if (sg && opts.designDetails) {
      styleByGoId.delete(g.garmentOrderId);
      middleSections.push(styleSelectionsPages([sg], pageNum, totalPages));
      middleLabels.push(`Style selections — ${sg.garmentLabel}`);
      pageNum++;
    }
  }
  if (opts.designDetails) {
    for (const sg of styleByGoId.values()) {
      middleSections.push(styleSelectionsPages([sg], pageNum, totalPages));
      middleLabels.push(`Style selections — ${sg.garmentLabel}`);
      pageNum++;
    }
  }

  // Slice body measurements into pages of 1 (large guide photo per page).
  const bodySections: string[] = [];
  if (opts.measurementDetails) {
    for (let i = 0; i < bodyPages; i++) {
      const slice = bodyMeasurements.slice(i * bodyPerPage, (i + 1) * bodyPerPage);
      bodySections.push(bodyMeasurementsPage(slice, bodyStart + i, totalPages));
    }
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

  /* Body measurement pages: 1 metric per page, large image for tailor */
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

  .metric-row {
    display: flex;
    flex-direction: column;
    gap: 14pt;
    border: 1px solid #e2e8f0;
    border-radius: 8pt;
    padding: 14pt;
    margin-bottom: 14pt;
    break-inside: avoid;
  }
  .metric-image {
    width: 100%;
    /* No fixed height — the image sets the box height so its aspect ratio is
       preserved exactly. max-height keeps it within one A4 page. */
    max-height: 510pt;      /* ~18cm — fits below the header/value row */
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    overflow: hidden;
    background: #f8fafc;
  }
  .metric-image img,
  .metric-image canvas {
    /* Fill the card width; height follows the image's natural aspect ratio. */
    width: 100%;
    height: auto;
    max-height: 510pt;
    object-fit: contain;
    display: block;
  }
  .img-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10pt;
    color: #94a3b8;
  }
  .metric-body {
    display: flex;
    flex-direction: column;
    gap: 10pt;
  }
  .metric-headline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16pt;
  }
  .metric-names { min-width: 0; }
  .name { font-size: 13pt; line-height: 1.3; }
  .name-en { font-weight: 700; color: #0f172a; }
  .name-hi { color: #1e293b; font-size: 12pt; }
  .name-kn { color: #1e293b; font-size: 12pt; }
  .metric-desc {
    font-size: 10pt;
    color: #475569;
    line-height: 1.4;
  }
  .metric-desc div { margin-bottom: 2pt; }
  .desc-hi, .desc-kn { color: #64748b; }

  .metric-value {
    text-align: center;
    border-left: 1px dashed #cbd5e1;
    padding-left: 18pt;
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
  }
  .value-label {
    font-size: 9pt;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    color: #94a3b8;
    letter-spacing: 1pt;
    margin-bottom: 4pt;
  }
  .value-text {
    font-size: 22pt;
    font-weight: 700;
    color: #0f172a;
  }

  /* Garment pages */
  .garment-names {
    margin-bottom: 12pt;
  }
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

  /* Per-garment measurement readings (garment-scoped) on garment pages */
  .garment-readings { margin: 4pt 0 8pt; }
  .block-title {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #0f172a;
    margin: 6pt 0 4pt;
  }
  .readings-table { width: 100%; border-collapse: collapse; }
  .readings-table td {
    padding: 3pt 8pt;
    font-size: 10pt;
    border-bottom: 1px solid #e2e8f0;
  }
  .readings-table td.mono {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    text-align: right;
    white-space: nowrap;
  }

  .report-footer {
    margin-top: auto;
    padding-top: 10pt;
    border-top: 1px solid #e2e8f0;
    font-size: 8.5pt;
    color: #94a3b8;
    text-align: center;
  }

  /* ─── Style selections page ───────────────────────────────────────────── */

  .style-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8pt;
    margin-bottom: 14pt;
    font-size: 10.5pt;
  }
  .style-photos { margin-bottom: 14pt; }
  .style-photos-label {
    font-size: 9pt;
    font-weight: 600;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 0.8pt;
    color: #475569;
    margin-bottom: 6pt;
  }
  .addon-pill {
    background: #6d28d9 !important; /* purple, distinguishes from black */
    margin-right: 6pt;
  }

  /* ─── Style selections page — redesigned hero + spec chips ──────────── */

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
       fix as .meta-pill / .spec-chip-badge. */
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

  /* Spec grid: a two-column table layout. We deliberately use display:table
     (NOT CSS grid) because html2canvas renders tables/inline-block reliably
     while its CSS Grid support is flaky — grid 1fr columns often resolve
     wrong and let children overflow their cell. Fixed 50/50 table columns
     guarantee each chip stays inside its half of the page width. */
  .spec-grid {
    display: table;
    width: 100%;
    border-collapse: separate;
    border-spacing: 10pt 0;
    table-layout: fixed;
    margin: 0 -10pt 12pt -10pt; /* cancel outer spacing so it aligns */
  }
  .spec-grid-row { display: table-row; }
  .spec-cell {
    display: table-cell;
    width: 50%;
    vertical-align: top;
  }
  .spec-chip {
    border: 1px solid #e2e8f0;
    border-radius: 8pt;
    padding: 10pt 12pt;
    background: #ffffff;
  }
  /* Header row inside each chip: component label on the left, badge on the
     right. Inline (NOT absolutely positioned) so html2canvas measures it in
     normal flow — absolute positioning was the main cause of the badge text
     overflowing the chip edge. */
  .spec-chip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8pt;
    margin-bottom: 4pt;
  }
  .spec-chip-component {
    font-size: 8.5pt;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 0.4pt;
    color: #94a3b8;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spec-chip-choice {
    font-size: 12pt;
    font-weight: 700;
    color: #0f172a;
    line-height: 1.3;
    word-break: break-word;
  }
  .spec-chip-placement {
    font-size: 9pt;
    color: #64748b;
    margin-top: 4pt;
    font-style: italic;
  }
  /* Add-on chips get a purple accent to distinguish from design variations. */
  .spec-chip-addon {
    border-color: #ddd6fe;
    background: #faf5ff;
  }
  .spec-chip-badge {
    display: inline-block;
    flex: 0 0 auto;
    font-size: 7.5pt;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    font-weight: 700;
    color: #ffffff;
    background: #6d28d9;
    /* WHY these specific values: html2canvas under-sizes the painted
       background of an inline-block with padding (it paints the bg at the
       content-box width, ignoring padding), so a tight pill with
       border-radius:999pt clips the badge text on the right. An EXPLICIT
       width + square corners + content-box + generous padding makes the
       background wide enough to fully cover the text. Verified at scale 3. */
    padding: 3pt 14pt;
    width: 46pt;
    text-align: center;
    letter-spacing: 0;
    box-sizing: content-box;
    border-radius: 3pt;
    white-space: nowrap;
  }
  .style-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5pt;
    margin-top: 4pt;
  }
  .style-table thead th {
    background: #f1f5f9;
    color: #475569;
    font-weight: 600;
    /* text-transform removed: html2canvas ignores it and mis-measures
       uppercased glyphs, clipping them. Text is uppercased at the source
       via upper() instead, so measurement and rendering match. */
    letter-spacing: 0.8pt;
    font-size: 9pt;
    text-align: left;
    padding: 6pt 8pt;
    border-bottom: 1px solid #cbd5e1;
  }
  .style-table tbody td {
    padding: 6pt 8pt;
    border-bottom: 1px solid #e2e8f0;
    color: #0f172a;
    vertical-align: top;
  }
  .style-cell-label {
    font-weight: 500;
  }
  .style-cell-price,
  .style-th-price {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .style-table tfoot td {
    padding: 6pt 8pt;
    border-top: 1px solid #cbd5e1;
    font-weight: 600;
    color: #0f172a;
  }
  .style-base-row td {
    background: #f8fafc;
    color: #475569;
    font-weight: 500;
    font-size: 10pt;
  }
  .style-total-row td {
    background: #0f172a;
    color: #ffffff !important;
    font-size: 12pt;
    font-weight: 700;
  }
`;
