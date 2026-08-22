import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL = "http://localhost:3002/admin/orders/7f26ccee-8001-4574-bac5-f489638173c3";
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
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".garment-page")).map((pg) => {
    const h = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return Math.round(r.height) + "+m" + Math.round(parseFloat(cs.marginTop) + parseFloat(cs.marginBottom));
    };
    return {
      header: pg.querySelector("header h2")?.textContent.trim(),
      pageH: Math.round(pg.getBoundingClientRect().height),
      headerH: h(pg.querySelector(".page-header")),
      heroH: h(pg.querySelector(".style-hero")),
      labelH: h(pg.querySelector(".style-section-label")),
      tableH: h(pg.querySelector(".gs-table")),
      theadH: h(pg.querySelector(".gs-table thead")),
      trHeights: Array.from(pg.querySelectorAll(".gs-table tbody tr")).map((tr) => Math.round(tr.getBoundingClientRect().height)),
      footerH: h(pg.querySelector(".report-footer")),
      otherChildren: Array.from(pg.children).map((c) => c.className || c.tagName),
    };
  });
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
