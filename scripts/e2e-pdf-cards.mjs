/**
 * Inspect the rendered garment-section pages mid-generation: print each page's
 * table rows (ground truth for titles/selected/descriptions/values) and
 * screenshot full pages + the inspiration note. Driver pattern shared with
 * e2e-pdf-preview.mjs; this is the focused DOM-dump variant.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
  process.env.ORDER_URL ??
  "http://localhost:3002/admin/orders/7f26ccee-8001-4574-bac5-f489638173c3";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGE ERROR:", err.message));

await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.evaluate((t) => localStorage.setItem("draep_admin_token", t), TOKEN);
await page.goto(ORDER_URL, { waitUntil: "domcontentloaded" });

await page
  .getByRole("button", { name: "⤓ Download PDF" })
  .waitFor({ state: "visible", timeout: 30000 });
await page.getByRole("button", { name: "⤓ Download PDF" }).click();
await page
  .getByRole("button", { name: /Generate PDF/i })
  .waitFor({ state: "visible", timeout: 10000 });
await page.getByRole("button", { name: /Generate PDF/i }).click();

await page.waitForSelector(".garment-page", { timeout: 60000 });
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const holder = document.querySelector("[data-pdf-holder]");
  holder.style.left = "0";
  holder.style.top = "0";
  holder.style.zIndex = "2147483647";
  for (const el of Array.from(document.body.children)) {
    if (el !== holder) el.style.visibility = "hidden";
  }
});

// Ground truth: header, labels, and every table row's cells per page
const data = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".garment-page")).map((pg) => ({
    header: pg.querySelector("header h2")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    hero: pg.querySelector(".style-hero-label")?.textContent?.trim() ?? null,
    labels: Array.from(pg.querySelectorAll(".style-section-label")).map((l) =>
      l.textContent.trim(),
    ),
    note: pg.querySelector(".gs-note")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    tables: Array.from(pg.querySelectorAll(".gs-table")).map((t) => ({
      head: Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent.trim()),
      rows: Array.from(t.querySelectorAll("tbody tr")).map((tr) =>
        Array.from(tr.querySelectorAll("td")).map((td) =>
          td.textContent.replace(/\s+/g, " ").trim(),
        ),
      ),
    })),
    materialCards: pg.querySelectorAll(".material-card").length,
    userNote: pg.querySelector(".user-note")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    footer: pg.querySelector("footer")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
  }));
});
console.log(JSON.stringify(data, null, 2));

const count = await page.locator(".garment-page").count();
for (let i = 0; i < count; i++) {
  await page
    .locator(".garment-page")
    .nth(i)
    .screenshot({ path: `/tmp/pdf-garment-page-${i + 1}.png` });
}
console.log("full pages saved:", count);

const download = await page.waitForEvent("download", { timeout: 240000 });
await download.saveAs("/tmp/" + download.suggestedFilename());
console.log("downloaded");
await browser.close();
