/** Deterministic overflow check for the flowed garment-section pages: does
 *  any block spill past the page's content box or under the footer? Run
 *  during a live generation. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
  process.env.ORDER_URL ??
  "http://localhost:3002/admin/orders/7f26ccee-8001-4574-bac5-f489638173c3";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.evaluate((t) => localStorage.setItem("draep_admin_token", t), TOKEN);
await page.goto(ORDER_URL, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "⤓ Download PDF" }).waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "⤓ Download PDF" }).click();
await page.getByRole("button", { name: /Generate PDF/i }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: /Generate PDF/i }).click();
await page.waitForSelector(".garment-page", { timeout: 60000 });
await page.waitForTimeout(1200);

const report = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll("[data-pdf-holder] .page"));
  const garments = Array.from(document.querySelectorAll(".garment-page"));
  const perPage = (pg, idx) => {
    const pgBox = pg.getBoundingClientRect();
    const footer = pg.querySelector("footer");
    const footerTop = footer ? footer.getBoundingClientRect().top : pgBox.bottom;
    // content blocks = page children other than header/footer chrome
    const blocks = Array.from(pg.children).filter(
      (c) => !c.matches("header, footer"),
    );
    let spill = 0;
    let deepest = 0;
    for (const c of blocks) {
      const b = c.getBoundingClientRect();
      if (b.bottom > footerTop + 0.5 || b.top < pgBox.top - 0.5) spill++;
      deepest = Math.max(deepest, b.bottom);
    }
    return {
      page: idx + 1,
      cls: pg.className.replace("page ", ""),
      pageHeight: Math.round(pgBox.height),
      scrollOverflowPx: pg.scrollHeight - pg.clientHeight,
      blocks: blocks.length,
      deepestBlockVsFooter: Math.round(footerTop - deepest),
      blocksCrossingFooter: spill,
      labels: Array.from(pg.querySelectorAll(".style-section-label")).map((l) =>
        l.textContent.trim(),
      ),
      headerText:
        pg.querySelector("header h2")?.textContent?.replace(/\s+/g, " ").trim() ??
        null,
      footerText:
        footer?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    };
  };
  return {
    allPages: pages.map(perPage),
    garmentCount: garments.length,
    garmentRows: garments.reduce(
      (n, g) => n + g.querySelectorAll(".gs-table tbody tr").length,
      0,
    ),
    measTableRows: garments.reduce(
      (n, g) =>
        n +
        Array.from(g.querySelectorAll(".gs-table"))
          .filter((t) => t.textContent.includes("Measurement"))
          .reduce((m, t) => m + t.querySelectorAll("tbody tr").length, 0),
      0,
    ),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
