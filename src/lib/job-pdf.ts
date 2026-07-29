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
 *   Pages 2..N — Body measurements, 4 per page
 *   Final page(s) — Garment details: materials, colors, photos, comments
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

// ─── Style selections (optional extension) ─────────────────────────────────

/** A garment order paired with its design items, for the PDF style pages. */
export interface StyleSelectionGroup {
  garmentOrder: GarmentOrderRow;
  /** A display label for the garment (resolved by the caller). */
  garmentLabel: string;
  basePrice: number | null;
  items: GarmentOrderItemRow[];
}

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

// ─── Section builders ────────────────────────────────────────────────────

function coverPage(
  job: MeasurementJobRow,
  customer: UserRow | null,
  order: OrderRow | null,
  address: AddressRow | null,
): string {
  const ord = order ?? null;

  // Build address display
  const addrParts: string[] = [];
  if (address?.address_line_1) addrParts.push(esc(address.address_line_1));
  if (address?.address_line_2) addrParts.push(esc(address.address_line_2));
  const cityLine = [
    address?.city,
    address?.state,
    address?.pincode,
  ].filter(Boolean).map(esc).join(", ");
  if (cityLine) addrParts.push(cityLine);
  const addrHtml = addrParts.length > 0
    ? addrParts.join("<br/>")
    : "<em class='muted'>No address on file</em>";

  return `
    <section class="page cover-page">
      <header class="brand-header">
        <h1>DRAEP</h1>
        <div class="subtitle">Measurement Report</div>
      </header>

      <div class="cover-grid">
        <div class="cover-block">
          <h2>Order Details</h2>
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
          <h2>Customer Details</h2>
          <table class="kv">
            <tr><th>Name</th><td>${esc(customer?.name ?? "—")}</td></tr>
            <tr><th>Phone</th><td>${esc(customer?.phone ?? "—")}</td></tr>
            <tr><th>Email</th><td>${esc(customer?.email ?? "—")}</td></tr>
            <tr><th>Customer ID</th><td>${esc(customer?.id ?? job.user_id ?? "—")}</td></tr>
          </table>
          <h2 style="margin-top:14pt;">Delivery Address</h2>
          <div class="address-body">${addrHtml}</div>
        </div>
      </div>

      <div class="cover-block notes-block">
        <h2>Notes</h2>
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

/** 4 body-measurement rows on a single page. */
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
          <div class="metric-content">
            <div class="metric-names">
              <div class="name name-en">${esc(labels.en ?? metric.code ?? "—")}</div>
              ${labels.hi ? `<div class="name name-hi">${esc(labels.hi)}</div>` : ""}
              ${labels.kn ? `<div class="name name-kn">${esc(labels.kn)}</div>` : ""}
            </div>
            <div class="metric-desc">
              ${descriptions.en ? `<div>${esc(descriptions.en)}</div>` : ""}
              ${descriptions.hi ? `<div class="desc-hi">${esc(descriptions.hi)}</div>` : ""}
              ${descriptions.kn ? `<div class="desc-kn">${esc(descriptions.kn)}</div>` : ""}
            </div>
          </div>
          <div class="metric-value">
            <div class="value-label">Value</div>
            <div class="value-text">${fmtValue(reading, metric)}</div>
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
  if (groups.length === 0) {
    return `
      <section class="page garment-page">
        <header class="page-header"><h2>Garment Details</h2></header>
        <p class="muted">No garment measurements captured for this job.</p>
        <footer class="report-footer">DRAEP Measurement Report</footer>
      </section>
    `;
  }

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
              ${m.type ? `<span class="meta-pill">${esc(m.type)}</span>` : ""}
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
      return `
        <section class="page garment-page">
          <header class="page-header">
            <h2>Garment: ${esc(garmentName)}</h2>
            <div class="page-num">Page ${currentPageNum} of ${totalPageCount}</div>
          </header>

          <div class="garment-names">
            ${garmentNameHi ? `<div class="name name-hi">${esc(garmentNameHi)}</div>` : ""}
            ${garmentNameKn ? `<div class="name name-kn">${esc(garmentNameKn)}</div>` : ""}
          </div>

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

      const variationRows = variations
        .map((it) => {
          return `
            <tr>
              <td class="style-cell-label">${esc(it.label_snapshot ?? "—")}</td>
              <td>${esc(it.placement ?? "—")}</td>
            </tr>
          `;
        })
        .join("");

      const addonRows = addons
        .map((it) => {
          return `
            <tr>
              <td class="style-cell-label">
                <span class="meta-pill addon-pill">Add-on</span>
                ${esc(it.label_snapshot ?? "—")}
              </td>
              <td>${esc(it.placement ?? "—")}</td>
            </tr>
          `;
        })
        .join("");

      const allRows = (variationRows + addonRows).trim();
      const tableHtml = allRows
        ? `
          <table class="style-table">
            <thead>
              <tr>
                <th>Selection</th>
                <th>Placement</th>
              </tr>
            </thead>
            <tbody>
              ${allRows}
            </tbody>
          </table>
        `
        : `<p class="muted">No style selections recorded for this garment order.</p>`;

      const userNote = g.garmentOrder.user_note
        ? `<div class="user-note"><strong>Customer note:</strong> ${esc(g.garmentOrder.user_note)}</div>`
        : "";

      const currentPageNum = pageNum++;
      return `
        <section class="page garment-page style-page">
          <header class="page-header">
            <h2>Style Selections: ${esc(g.garmentLabel)}</h2>
            <div class="page-num">Page ${currentPageNum} of ${totalPageCount}</div>
          </header>

          <div class="style-meta">
            <span class="meta-pill">Garment Order</span>
            <span class="meta-name">${esc(g.garmentLabel)}</span>
            <span class="meta-dim">GO ID: ${esc(g.garmentOrder.id.slice(0, 8))}</span>
            ${g.garmentOrder.status ? `<span class="meta-dim">Status: ${esc(g.garmentOrder.status.replace(/_/g, " "))}</span>` : ""}
          </div>

          ${tableHtml}

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
  } = input;

  // Lazily import the heavy libraries so they don't bloat the main bundle
  // (Next.js code-splits dynamic imports automatically).
  const [{ default: html2canvas }, jspdfMod, { default: saveAs }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    import("file-saver"),
  ]);
  const jsPDF = jspdfMod.jsPDF ?? jspdfMod.default;

  onProgress?.(0, 1, "Building layout…");

  // Compute pagination: 4 body rows per page
  const bodyPerPage = 4;
  const bodyPages = Math.max(1, Math.ceil(bodyMeasurements.length / bodyPerPage));
  const garmentPages = Math.max(1, garmentMeasurements.length);
  const styleGroups = styleSelections ?? [];
  const stylePages = styleGroups.length;
  const totalPages =
    1 /* cover */ + bodyPages + garmentPages + stylePages;

  // Slice body measurements into pages of 4
  const bodySections: string[] = [];
  for (let i = 0; i < bodyPages; i++) {
    const slice = bodyMeasurements.slice(i * bodyPerPage, (i + 1) * bodyPerPage);
    bodySections.push(bodyMeasurementsPage(slice, 2 + i, totalPages));
  }

  const garmentSections = garmentDetailsPages(
    garmentMeasurements,
    2 + bodyPages,
    totalPages,
  );

  const styleSections = styleSelectionsPages(
    styleGroups,
    2 + bodyPages + garmentPages,
    totalPages,
  );

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
  ${coverPage(job, customer, order, address ?? null)}
  ${bodySections.join("")}
  ${garmentSections}
  ${styleSections}
</body>
</html>`;

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
    // so we don't capture empty <img> boxes.
    onProgress?.(0, pageEls.length, "Loading images…");
    // Replace every [data-pdf-src] <img> with a pre-rasterized <canvas>. This
    // sidesteps html2canvas's cross-origin image loader entirely (its loader
    // cache was silently dropping the material photo due to a cross-origin
    // attribute/taint mismatch). Canvases are copied via drawImage — no
    // network, no CORS, no taint, no blank slots.
    await inlineImagesAsCanvases(holder);
    await waitForImages(holder);

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

    // Rasterize each .page element to a canvas, add to PDF as one page each.
    for (let i = 0; i < pageEls.length; i++) {
      const el = pageEls[i];
      const label =
        i === 0
          ? "Cover page"
          : i <= bodyPages
            ? `Body measurements page ${i}`
            : i <= bodyPages + garmentPages
              ? `Garment details page ${i - bodyPages}`
              : `Style selections page ${i - bodyPages - garmentPages}`;
      onProgress?.(i, pageEls.length, `Rendering ${label}…`);

      // Allow the browser to paint the progress update before the
      // (synchronous, heavy) html2canvas call blocks the main thread.
      await nextPaint();

      const canvas = await html2canvas(el, {
        scale: 2, // 2x for crisp output (~144 DPI)
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
      } else {
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, Math.min(imgH, pageHeightMm));
      }
    }

    onProgress?.(pageEls.length, pageEls.length, "Saving file…");
    await nextPaint();

    const filename = `DRAEP-Measurement-${(job.id ?? "report").slice(0, 8)}.pdf`;
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

/** Resolve once every <img> under `root` has fired load OR error. */
function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
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
        const res = await fetch(abs);
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
    const targetW = parseInt(computed.width, 10) || decoded.naturalWidth;
    const targetH = parseInt(computed.height, 10) || decoded.naturalHeight;

    const canvas = document.createElement("canvas");
    // 2x for crisp PDF output at the same display size.
    canvas.width = Math.max(1, targetW) * 2;
    canvas.height = Math.max(1, targetH) * 2;
    canvas.style.width = `${targetW}px`;
    canvas.style.height = `${targetH}px`;
    canvas.style.display = img.style.display || "block";
    canvas.style.borderRadius = computed.borderRadius;
    canvas.style.border = computed.border;
    canvas.style.objectFit = "cover";
    canvas.style.background = computed.background;

    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.scale(2, 2);
    // Use 'cover' semantics — match the CSS `object-fit: cover` of .photo-grid img.
    // Compute source/dest rectangles to fill the target box while preserving aspect.
    const imgAspect = decoded.naturalWidth / decoded.naturalHeight;
    const boxAspect = targetW / targetH;
    let sx = 0, sy = 0, sw = decoded.naturalWidth, sh = decoded.naturalHeight;
    if (imgAspect > boxAspect) {
      // Image wider than box — crop horizontally.
      sw = decoded.naturalHeight * boxAspect;
      sx = (decoded.naturalWidth - sw) / 2;
    } else if (imgAspect < boxAspect) {
      // Image taller than box — crop vertically.
      sh = decoded.naturalWidth / boxAspect;
      sy = (decoded.naturalHeight - sh) / 2;
    }
    ctx.drawImage(decoded, sx, sy, sw, sh, 0, 0, targetW, targetH);

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
    text-transform: uppercase;
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

  /* Body measurement pages: 4 rows per page */
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
    display: grid;
    grid-template-columns: 60pt 1fr 90pt;
    gap: 12pt;
    border: 1px solid #e2e8f0;
    border-radius: 6pt;
    padding: 10pt;
    margin-bottom: 12pt;
    break-inside: avoid;
  }
  .metric-row:nth-child(4n) {
    page-break-after: always;
  }
  .metric-image {
    width: 60pt;
    height: 60pt;
    border: 1px solid #e2e8f0;
    border-radius: 4pt;
    overflow: hidden;
    background: #f8fafc;
  }
  .metric-image img,
  .metric-image canvas {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .img-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 7pt;
    color: #94a3b8;
  }
  .metric-content { min-width: 0; }
  .metric-names { margin-bottom: 4pt; }
  .name { font-size: 11pt; line-height: 1.3; }
  .name-en { font-weight: 700; color: #0f172a; }
  .name-hi { color: #1e293b; font-size: 10pt; }
  .name-kn { color: #1e293b; font-size: 10pt; }
  .metric-desc {
    font-size: 8.5pt;
    color: #475569;
    line-height: 1.35;
  }
  .metric-desc div { margin-bottom: 2pt; }
  .desc-hi, .desc-kn { color: #64748b; }

  .metric-value {
    text-align: center;
    border-left: 1px dashed #cbd5e1;
    padding-left: 8pt;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .value-label {
    font-size: 8pt;
    text-transform: uppercase;
    color: #94a3b8;
    letter-spacing: 1pt;
    margin-bottom: 4pt;
  }
  .value-text {
    font-size: 14pt;
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
    padding: 2pt 8pt;
    background: #0f172a;
    color: #ffffff;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.8pt;
    border-radius: 999pt;
    font-weight: 600;
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
    text-transform: uppercase;
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
  }
  .photo-grid img,
  .photo-grid canvas {
    /* Fixed pixel dims - html2canvas (older CSS engine) handles explicit
       px sizes much more reliably than aspect-ratio or grid auto-rows. */
    width: 200px;
    height: 200px;
    object-fit: cover;
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

  /* ─── Style selections page ───────────────────────────────────────────── */

  .style-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8pt;
    margin-bottom: 14pt;
    font-size: 10.5pt;
  }
  .addon-pill {
    background: #6d28d9 !important; /* purple, distinguishes from black */
    margin-right: 6pt;
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
    text-transform: uppercase;
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
