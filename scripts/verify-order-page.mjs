/**
 * Headless smoke test for the order-detail page rework:
 *  1. Compact garment cards (no expander, no items table) with footer CTAs.
 *  2. "Edit selections" opens the design sheet; the AI "Upload reference"
 *     flow lives in a second tab inside that same sheet.
 *  3. Key Hole placement chips come from the variations' actual placements
 *     (not stale metadata) and each slot renders Shape + Size matrix rows.
 * Run: node scripts/verify-order-page.mjs <token>
 */
import { chromium } from "playwright";

const TOKEN = process.argv[2];
const URL = "http://localhost:3002/admin/orders/d1f5203d-e848-437e-ad6c-7579afe9f1be";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem("draep_admin_token", t), TOKEN);
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const logs = [];
page.on("console", (m) => {
  if (m.type() === "error") logs.push(`console.error ${at()}: ` + m.text());
});
page.on("pageerror", (e) => logs.push(`pageerror ${at()}: ` + e.message));
page.on("response", async (r) => {
  if (r.status() === 404 && !r.url().includes("/uploads/")) logs.push(`404 ${at()}: ` + r.url());
  if (r.status() >= 500) {
    let body = "";
    try {
      body = (await r.text()).slice(0, 400);
    } catch {}
    logs.push(`${r.status()} ${at()}: ${r.url()} — ${body}`);
  }
  if (r.request().method() === "POST" && r.url().includes(":8000")) {
    logs.push(`api-post ${at()} ${r.status()}: ${r.url().replace("http://localhost:8000", "")}`);
    if (r.url().includes("/design-ai/chat")) {
      logs.push(`chat-body ${at()}: pending…`);
      r.text()
        .then((b) => logs.push(`chat-body ${at()}: DONE ${b.length} bytes`))
        .catch((e) => logs.push(`chat-body ${at()}: ERR ${e.message}`));
    }
  }
});

let failed = false;
const fail = (msg) => {
  console.error("FAIL:", msg);
  failed = true;
};
const ok = (msg) => console.log("ok  :", msg);

await page.goto(URL, { waitUntil: "domcontentloaded" });
// Dev-server HMR can serve a stale chunk on the first hit after an edit —
// a reload re-fetches freshly compiled HTML + chunks.
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Edit selections" }).first().waitFor({ timeout: 15000 });
ok("order page loaded with garment cards");

// 1. Compact card: no items table, footer CTAs visible without any expand step
const card = page.locator("div.overflow-hidden.rounded-xl").filter({ hasText: "GO ID: 15310a99" });
(await card.locator("table").count()) === 0
  ? ok("items table removed from the card")
  : fail("card still renders an items table");
(await card.getByText(/^Items\b/i).count()) === 0
  ? ok("'Items (n)' heading removed")
  : fail("'Items (n)' heading still present");
// Items load async per GO — wait for the count to appear before asserting.
// (waitForFunction's 2nd arg is the function arg, NOT options — the timeout
// must go in the 3rd position or you silently get Playwright's 30s default.)
await page
  .waitForFunction(
    () => /\d+ selections/.test(document.body.innerText),
    null,
    { timeout: 10000 },
  )
  .catch(() => {});
(await card.getByText(/\d+ selections/).count()) >= 1
  ? ok("selection count shown compactly in the header")
  : fail("selection count missing from the header");
(await card.getByRole("button", { name: /Upload Reference/ }).count()) === 0
  ? ok("Upload Reference no longer a card-level CTA (moved into the sheet)")
  : fail("card still has an Upload Reference CTA");
(await card.getByRole("button", { name: /Reset design/ }).count()) === 0
  ? ok("Reset design button removed")
  : fail("Reset design button still present");

await card.getByRole("button", { name: "Edit selections" }).click();
ok("clicked Edit selections");

// 2. Sheet opens with the Manual select / Upload reference tab bar
const cancel = page.getByRole("button", { name: "Cancel" });
await cancel.waitFor({ timeout: 5000 });
ok("selections sheet opened");

const refTab = page.getByRole("button", { name: "Upload reference" });
const manualTab = page.getByRole("button", { name: "Manual select" });
(await refTab.count()) === 1 && (await manualTab.count()) === 1
  ? ok("sheet has Manual select / Upload reference tabs")
  : fail("sheet tab bar missing");

// Switch to the AI tab — the reference flow renders inside the sheet
await refTab.click();
await page.waitForTimeout(600);
const aiArea = await page.getByText(/Upload a reference image|Analyze with AI|AI Design Prefill/i).count();
aiArea > 0 ? ok("AI reference flow renders inside the sheet's Upload reference tab") : fail("AI reference flow not visible in the sheet");

// Auto-analyze: upload a photo — no Analyze press. The AI call runs, and a
// photo with detectable design elements prefills the sheet and flips it
// back to Manual select on its own. (A blank swatch yields zero selections
// and deliberately does NOT flip — so use a real garment reference photo.)
import { readFileSync } from "node:fs";
const REF_PHOTO = "/Users/vishantbatta/Documents/Draep tech/be/uploads/design_refs/06b4d5b28ad5430eb3f62389c83c1d15.jpeg";
let photoBuffer;
let photoName = "ref.png";
try {
  photoBuffer = readFileSync(REF_PHOTO);
  photoName = "ref.jpeg";
} catch {
  photoBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}
// Scoped to the sheet overlay — the page also has per-card assets file
// inputs, so a bare input[type=file].first() would hit the wrong handler.
await page.locator('div.fixed.inset-0 input[type="file"]').first().setInputFiles({
  name: photoName,
  mimeType: photoName.endsWith(".jpeg") ? "image/jpeg" : "image/png",
  buffer: photoBuffer,
});
logs.push(`script ${at()}: setInputFiles done`);
// NOTE: timeout is the 3rd arg — waitForFunction(fn, arg, options).
const flipped = await page
  .waitForFunction(
    () => {
      const m = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Manual select",
      );
      return !!m && m.className.includes("shadow-card");
    },
    null,
    { timeout: 120000 },
  )
  .then(() => true)
  .catch(() => false);
logs.push(`script ${at()}: flip wait ended flipped=${flipped}`);
if (!flipped) {
  const sheetText = await page
    .locator("div.fixed.inset-0")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => "<sheet gone>");
  console.error("DEBUG sheet text:\n" + sheetText.slice(-1500));
}
flipped
  ? ok("photo upload auto-analyzes and flips the sheet back to Manual select")
  : fail("sheet did not flip back to Manual select after photo upload");

// 3. Key Hole matrix on the manual tab. The flip reseeds the sheet (tree
// refetch) — the cards appear a beat after the tab switches, so wait for it.
const kh = page.locator("div.rounded-card").filter({ hasText: /^Key Hole/ }).first();
const khFound = await kh.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
if (!khFound) {
  fail("Key Hole add-on card not found");
} else {
  await kh.scrollIntoViewIfNeeded();
  await kh.getByRole("button", { name: "+ Add" }).click();
  await page.waitForTimeout(400);

  // Placement chips should be exactly the live catalog's four placements
  for (const chip of ["Back", "Front", "Left sleeve", "Right sleeve"]) {
    const c = await kh.getByRole("button", { name: chip, exact: true }).count();
    c === 1 ? ok(`placement chip "${chip}" present`) : fail(`placement chip "${chip}" missing`);
  }
  for (const stale of ["Back Cut", "Front neck cut", "Blouse cut"]) {
    const c = await kh.getByText(stale, { exact: true }).count();
    c === 0 ? ok(`stale placement "${stale}" absent`) : fail(`stale placement "${stale}" still offered`);
  }

  // Toggle Front → Shape + Size matrix rows appear
  await kh.getByRole("button", { name: "Front", exact: true }).click();
  await page.waitForTimeout(400);
  const shape = await kh.getByText("Shape", { exact: true }).count();
  const size = await kh.getByText("Size", { exact: true }).count();
  shape === 1 ? ok("Shape axis row renders") : fail("Shape axis row missing");
  size === 1 ? ok("Size axis row renders") : fail("Size axis row missing");

  // Pick Triangle + Medium → resolves with a price. (Small is usually the
  // inferred default; re-clicking it would deselect it — pick a non-default.)
  await kh.getByRole("button", { name: "Triangle", exact: true }).click();
  await kh.getByRole("button", { name: "Medium", exact: true }).click();
  await page.waitForTimeout(300);
  const resolved = await kh.getByText(/Triangle · Medium/i).count();
  resolved >= 1 ? ok("matrix combination resolves (Triangle · Medium)") : fail("matrix combination did not resolve");
}

// Close the sheet
await cancel.click();
await page.waitForTimeout(400);

if (logs.length) console.log("\nbrowser errors:\n" + logs.join("\n"));
await browser.close();
console.log(failed ? "\nRESULT: FAILED" : "\nRESULT: PASSED");
process.exit(failed ? 1 : 0);
