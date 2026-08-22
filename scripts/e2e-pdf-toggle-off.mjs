/** Toggle gating check: uncheck ONE section in the PDF bottom sheet BEFORE
 *  generating, then assert (1) that section's content is gone, (2) other
 *  sections' content is still there, (3) every footer renumbers to the
 *  reduced total. TOGGLE_TITLE picks the checkbox (default "Design
 *  details"). Verifies the user requirement that the sheet's section
 *  selections keep gating content as-is. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
  process.env.ORDER_URL ??
  "http://localhost:3002/admin/orders/a6984c20-5cfe-4d6a-a591-f8efd60c9b09";
/** Which sheet toggle to uncheck — see the sheet's section list. */
const TOGGLE_TITLE = process.env.TOGGLE_TITLE ?? "Design details";

/** DOM presence markers per toggle, used for the baseline ("present") and
 *  gated ("absent") runs. Each marker = [description, counter fn]. */
const MARKERS = {
  "Design details": [
    ["style/inspiration labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label, .gs-note"))
        .filter((l) => /STYLE SELECTIONS|REFERENCE ONLY/.test(l.textContent)).length],
  ],
  "Measurement details": [
    ["garment measurement labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label"))
        .filter((l) => l.textContent.includes("GARMENT MEASUREMENTS")).length],
    ["body measurement pages", (h) => h.querySelectorAll(".body-page").length],
  ],
  "Fabric details": [
    ["cloth & materials labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label"))
        .filter((l) => l.textContent.includes("CLOTH & MATERIALS")).length],
    ["material cards", (h) => h.querySelectorAll(".material-card").length],
  ],
};
/** Content that must SURVIVE the toggle for each TOGGLE_TITLE (one counter). */
const KEEP = {
  "Design details": [
    ["garment measurement labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label"))
        .filter((l) => l.textContent.includes("GARMENT MEASUREMENTS")).length],
    ["material cards", (h) => h.querySelectorAll(".material-card").length],
    ["body measurement pages", (h) => h.querySelectorAll(".body-page").length],
  ],
  "Measurement details": [
    ["style/inspiration labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label, .gs-note"))
        .filter((l) => /STYLE SELECTIONS|REFERENCE ONLY/.test(l.textContent)).length],
    ["material cards", (h) => h.querySelectorAll(".material-card").length],
  ],
  "Fabric details": [
    ["style/inspiration labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label, .gs-note"))
        .filter((l) => /STYLE SELECTIONS|REFERENCE ONLY/.test(l.textContent)).length],
    ["garment measurement labels", (h) =>
      Array.from(h.querySelectorAll(".style-section-label"))
        .filter((l) => l.textContent.includes("GARMENT MEASUREMENTS")).length],
  ],
};
if (!MARKERS[TOGGLE_TITLE] && TOGGLE_TITLE !== "Invoice") {
  console.error(`No markers defined for toggle "${TOGGLE_TITLE}"`);
  process.exit(2);
}
/** "Invoice" is special: its page is spliced outside the holder, so presence
 *  is asserted via the footer total (holder pages + 1 when ON, exact when
 *  OFF) rather than DOM markers. */
const isInvoice = TOGGLE_TITLE === "Invoice";
const count = (h, fns) => Object.fromEntries(fns.map(([d, f]) => [d, f(h)]));
const markerFns = isInvoice ? [] : MARKERS[TOGGLE_TITLE];

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.evaluate((t) => localStorage.setItem("draep_admin_token", t), TOKEN);
await page.goto(ORDER_URL, { waitUntil: "domcontentloaded" });
await page
  .getByRole("button", { name: "⤓ Download PDF" })
  .waitFor({ timeout: 30000 });

// Baseline with all toggles ON (default state of the sheet).
await page.getByRole("button", { name: "⤓ Download PDF" }).click();
await page
  .getByRole("button", { name: /Generate PDF/i })
  .waitFor({ timeout: 10000 });
await page.getByRole("button", { name: /Generate PDF/i }).click();
await page.waitForSelector("[data-pdf-holder] .garment-page, [data-pdf-holder] .body-page", { timeout: 60000 });
await page.waitForTimeout(1200);
const baseline = await page.evaluate(
  (fns) => {
    const h = document.querySelector("[data-pdf-holder]");
    return {
      pages: h.querySelectorAll(".page").length,
      markers: Object.fromEntries(fns.map(([d, s]) => [d, eval(s)(h)])),
    };
  },
  markerFns.map(([d, f]) => [d, f.toString()]),
);

// Reopen the sheet and uncheck the toggle, then regenerate.
await page
  .getByRole("button", { name: "⤓ Download PDF" })
  .click({ trial: false })
  .catch(() => {});
let toggleBox = page
  .locator(`label:has-text('${TOGGLE_TITLE}') input[type=checkbox]`)
  .first();
try {
  await toggleBox.waitFor({ state: "visible", timeout: 5000 });
} catch {
  await page
    .getByRole("button", { name: "⤓ Download PDF" })
    .click({ timeout: 5000 });
  await toggleBox.waitFor({ state: "visible", timeout: 10000 });
}
// Fresh holder: remove the old one so waitForSelector sees the new run.
await page.evaluate(() => {
  document
    .querySelectorAll("[data-pdf-holder]")
    .forEach((h) => h.remove());
});
await toggleBox.uncheck();
await page.getByRole("button", { name: /Generate PDF/i }).click();
await page.waitForSelector("[data-pdf-holder] .page.garment-page, [data-pdf-holder] .page.body-page, [data-pdf-holder] .page.cover-page", { timeout: 60000 });
await page.waitForTimeout(1200);

const gated = await page.evaluate(
  ({ mFns, kFns }) => {
    const h = document.querySelector("[data-pdf-holder]");
    const deserial = (s) => (hh) => eval(s)(hh);
    const footers = Array.from(h.querySelectorAll(".page footer")).map((f) =>
      (f.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    const totals = new Set(
      footers
        .map((f) => (f.match(/Page \d+ of (\d+)/) ?? [])[1])
        .filter(Boolean),
    );
    return {
      pageCount: h.querySelectorAll(".page").length,
      garmentPages: h.querySelectorAll(".garment-page").length,
      markers: Object.fromEntries(mFns.map(([d, s]) => [d, deserial(s)(h)])),
      keep: Object.fromEntries(kFns.map(([d, s]) => [d, deserial(s)(h)])),
      footerTotals: [...totals],
      footerSample: footers.slice(0, 2).concat(footers.slice(-2)),
    };
  },
  {
    mFns: markerFns.map(([d, f]) => [d, f.toString()]),
    kFns: (KEEP[TOGGLE_TITLE] ?? []).map(([d, f]) => [d, f.toString()]),
  },
);

console.log(JSON.stringify({ baseline, gated }, null, 2));

const failures = [];
for (const [d, n] of Object.entries(baseline.markers))
  if (!(n > 0)) failures.push(`baseline: ${d} missing even with toggles ON`);
for (const [d, n] of Object.entries(gated.markers))
  if (n !== 0) failures.push(`${TOGGLE_TITLE} OFF: still ${n} × ${d}`);
for (const [d, n] of Object.entries(gated.keep))
  if (!(n > 0)) failures.push(`${TOGGLE_TITLE} OFF: ${d} vanished (should stay)`);
if (!isInvoice && gated.pageCount >= baseline.pages)
  failures.push(
    `${TOGGLE_TITLE} OFF: page count did not shrink (${gated.pageCount} vs ${baseline.pages})`,
  );
if (gated.footerTotals.length !== 1)
  failures.push(`footer totals inconsistent: ${gated.footerTotals.join(", ")}`);
else {
  // The invoice renders from a separate container and jsPDF splices it in
  // mid-document, so the holder has pageCount elements while the footer
  // total counts the invoice page too — UNLESS the invoice toggle is OFF,
  // when the footer total must equal the holder page count exactly.
  const expectedTotal = gated.pageCount + (isInvoice ? 0 : 1);
  if (Number(gated.footerTotals[0]) !== expectedTotal)
    failures.push(
      `footer total ${gated.footerTotals[0]} != expected ${expectedTotal} (holder ${gated.pageCount}${isInvoice ? ", no invoice" : " + invoice 1"})`,
    );
}

console.log(
  failures.length === 0
    ? `\nTOGGLE GATING: OK (${TOGGLE_TITLE} off — its content gone, other sections kept, footers renumbered)`
    : `\nTOGGLE GATING: FAIL\n  - ${failures.join("\n  - ")}`,
);
await browser.close();
if (failures.length) process.exit(1);
