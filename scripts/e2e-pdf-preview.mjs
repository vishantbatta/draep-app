/**
 * One-off E2E: log into the admin app in headless Chromium, open the order
 * page, generate the measurement PDF via the real sheet, screenshot each
 * `.style-page` living in the offscreen PDF holder mid-generation, and save
 * the downloaded PDF. Run: node scripts/e2e-pdf-preview.mjs
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
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

await page.waitForSelector(".style-page", { timeout: 60000 });
await page.waitForTimeout(1000);

// The PDF holder renders offscreen (fixed, left:-99999px) and the Download
// PDF sheet overlay paints on top of its box, so element screenshots capture
// the sheet instead of the pages. Pull the holder on-screen, raise it above
// everything, and hide the rest of the page — the browser is ours and closes
// right after, so no restore is needed.
await page.evaluate(() => {
  const holder = document.querySelector("[data-pdf-holder]");
  if (!holder) throw new Error("PDF holder not found");
  holder.style.left = "0";
  holder.style.top = "0";
  holder.style.zIndex = "2147483647";
  for (const el of Array.from(document.body.children)) {
    if (el !== holder) el.style.visibility = "hidden";
  }
});
await page.waitForTimeout(200);

const count = await page.locator(".style-page").count();
console.log("style pages in holder:", count);
for (let i = 0; i < count; i++) {
  await page
    .locator(".style-page")
    .nth(i)
    .screenshot({ path: `/tmp/pdf-style-page-${i + 1}.png` });
  console.log("saved /tmp/pdf-style-page-" + (i + 1) + ".png");
}

const download = await page.waitForEvent("download", { timeout: 240000 });
const path = "/tmp/" + download.suggestedFilename();
await download.saveAs(path);
console.log("downloaded:", path);

await browser.close();
