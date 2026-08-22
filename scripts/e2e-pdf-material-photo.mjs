/**
 * Verify captain-captured material photos render in the PDF's 2.4 section.
 *
 * Generates the report on ORDER_URL (an order whose garment_order_materials
 * rows have LIVE photo URLs) with all toggles ON, then inspects the holder:
 * every .material-card with asset URLs must show a loaded image (pre-raster
 * swaps <img> → <canvas>; a 404 URL silently leaves nothing) in .photo-grid.
 *
 * Usage: node scripts/e2e-pdf-material-photo.mjs
 *   ORDER_URL  admin order detail URL (default: order with a reachable photo)
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = (
  await import("node:fs")
).readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
  process.env.ORDER_URL ??
  "http://localhost:3002/admin/orders/4403180a-5de9-4438-b48e-b5b2a5ffa207";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.evaluate((t) => localStorage.setItem("draep_admin_token", t), TOKEN);
await page.goto(ORDER_URL, { waitUntil: "domcontentloaded" });
await page
  .getByRole("button", { name: "⤓ Download PDF" })
  .waitFor({ timeout: 30000 });

await page.getByRole("button", { name: "⤓ Download PDF" }).click();
await page
  .getByRole("button", { name: /Generate PDF/i })
  .waitFor({ timeout: 10000 });
await page.getByRole("button", { name: /Generate PDF/i }).click();
await page.waitForSelector("[data-pdf-holder] .page.garment-page", {
  timeout: 60000,
});
await page.waitForTimeout(1500);

const result = await page.evaluate(() => {
  const h = document.querySelector("[data-pdf-holder]");
  const cards = Array.from(h.querySelectorAll(".material-card"));
  return {
    materialCards: cards.length,
    cards: cards.map((c) => {
      const grid = c.querySelector(".photo-grid");
      const empty = grid?.classList.contains("photo-grid-empty") ?? false;
      const imgs = grid ? grid.querySelectorAll("img").length : 0;
      const canvases = grid ? grid.querySelectorAll("canvas").length : 0;
      return {
        name: c.querySelector(".meta-name")?.textContent?.trim() ?? null,
        photoGridEmpty: empty,
        imgs,
        canvases,
        renderedImage: imgs + canvases > 0,
      };
    }),
    pages: h.querySelectorAll(".page").length,
  };
});

console.log(JSON.stringify(result, null, 2));

const failures = [];
if (result.materialCards === 0) failures.push("no material cards rendered");
for (const c of result.cards) {
  if (c.photoGridEmpty)
    failures.push(`material "${c.name}": photo grid says "No photos captured"`);
  else if (!c.renderedImage)
    failures.push(`material "${c.name}": no img/canvas in photo grid`);
}

console.log(
  failures.length === 0
    ? "\nMATERIAL PHOTOS: OK (captain photos render in the PDF's 2.4 cards)"
    : `\nMATERIAL PHOTOS: FAIL\n  - ${failures.join("\n  - ")}`,
);
await browser.close();
if (failures.length) process.exit(1);
