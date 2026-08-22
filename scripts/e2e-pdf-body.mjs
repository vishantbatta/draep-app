/** Body-measurements section check (full-page format): with all toggles ON,
 *  the order-level section renders ONE metric per page (large guide image
 *  card) and contains EXACTLY this job's base readings — garment-scoped ones
 *  stay in their garment's table. Also asserts NO ₹ pricing anywhere in the
 *  report holder (prices live only in the separately-spliced invoice).
 *  EXPECTED_BASE_ROWS is asserted against the DOM card count. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const TOKEN = readFileSync("/tmp/draep_admin_token", "utf8").trim();
const ORDER_URL =
  process.env.ORDER_URL ??
  "http://localhost:3002/admin/orders/e78ddbf5-7637-458d-b738-7e874c792efd";
const EXPECTED_BASE_ROWS = Number(process.env.EXPECTED_BASE_ROWS ?? "12");

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

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
await page.waitForSelector(".body-page", { timeout: 60000 });
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const holder = document.querySelector("[data-pdf-holder]");
  const allPages = Array.from(holder.querySelectorAll(".page"));
  const geometry = allPages.map((pg, i) => {
    const pgBox = pg.getBoundingClientRect();
    const footer = pg.querySelector("footer");
    const footerTop = footer ? footer.getBoundingClientRect().top : pgBox.bottom;
    let crossing = 0;
    for (const c of Array.from(pg.children)) {
      if (c.matches("header, footer")) continue;
      if (c.getBoundingClientRect().bottom > footerTop + 0.5) crossing++;
    }
    return {
      page: i + 1,
      cls: pg.className.replace("page ", ""),
      height: Math.round(pgBox.height),
      scrollOverflowPx: pg.scrollHeight - pg.clientHeight,
      crossing,
    };
  });
  const bodyPages = Array.from(holder.querySelectorAll(".body-page"));
  const footers = allPages.map((f) =>
    f.querySelector("footer")?.textContent?.replace(/\s+/g, " ").trim(),
  );
  return {
    totalHolderPages: allPages.length,
    geometry,
    badGeometry: geometry.filter(
      (g) => g.height !== 1123 || g.scrollOverflowPx !== 0 || g.crossing !== 0,
    ),
    bodyPages: bodyPages.map((pg) => ({
      header:
        pg.querySelector("header h2")?.textContent?.replace(/\s+/g, " ").trim() ??
        null,
      cards: pg.querySelectorAll(".metric-row").length,
      title: pg.querySelector(".name-en")?.textContent?.trim() ?? null,
      value: pg.querySelector(".value-text")?.textContent?.trim() ?? null,
      hasImage: pg.querySelector(".metric-image img, .metric-image canvas") !== null,
      hasGsTable: pg.querySelector(".gs-table") !== null,
      footer:
        pg.querySelector("footer")?.textContent?.replace(/\s+/g, " ").trim() ??
        null,
    })),
    bodyCardCount: bodyPages.reduce(
      (n, p) => n + p.querySelectorAll(".metric-row").length,
      0,
    ),
    garmentMeasRows: Array.from(holder.querySelectorAll(".garment-page"))
      .reduce(
        (n, p) =>
          n +
          Array.from(p.querySelectorAll(".gs-table"))
            .filter((t) =>
              t.querySelector("thead")?.textContent?.includes("Measurement"),
            )
            .reduce((m, t) => m + t.querySelectorAll("tbody tr").length, 0),
        0,
      ),
    rupeeHits: Array.from(
      holder.querySelectorAll(".gs-price"),
    ).length,
    rupeeTextHits: (holder.textContent?.match(/₹/g) ?? []).length,
    footerTotals: [
      ...new Set(
        footers
          .map((f) => (f ?? "").match(/Page \d+ of (\d+)/)?.[1])
          .filter(Boolean),
      ),
    ],
  };
});
console.log(JSON.stringify(report, null, 2));

// Screenshots of first + last body page (holder pulled on-screen).
await page.evaluate(() => {
  const holder = document.querySelector("[data-pdf-holder]");
  holder.style.left = "0";
  holder.style.top = "0";
  holder.style.zIndex = "2147483647";
  for (const el of Array.from(document.body.children)) {
    if (el !== holder) el.style.visibility = "hidden";
  }
});
const bodyCount = await page.locator(".body-page").count();
const shots = [0, bodyCount - 1];
for (const i of shots) {
  await page
    .locator(".body-page")
    .nth(i)
    .screenshot({ path: `/tmp/pdf-body-page-${i + 1}.png` });
}
console.log("body page screenshots saved:", bodyCount, "pages");

const failures = [];
if (report.bodyCardCount !== EXPECTED_BASE_ROWS)
  failures.push(
    `body cards ${report.bodyCardCount} != expected base readings ${EXPECTED_BASE_ROWS}`,
  );
if (report.bodyPages.some((p) => p.cards !== 1))
  failures.push("body pages must hold exactly ONE metric card each");
if (report.bodyPages.some((p) => !p.hasImage))
  failures.push("a body page is missing its guide image");
if (report.bodyPages.some((p) => p.hasGsTable))
  failures.push("body pages unexpectedly contain a gs-table");
if (report.bodyPages.some((p) => p.header !== "Body Measurements"))
  failures.push("body page header wrong");
if (report.rupeeHits !== 0 || report.rupeeTextHits !== 0)
  failures.push(
    `pricing leaked into the report: gs-price=${report.rupeeHits}, ₹ chars=${report.rupeeTextHits}`,
  );
if (report.badGeometry.length > 0)
  failures.push(`geometry: ${JSON.stringify(report.badGeometry)}`);
const expectedTotal = report.totalHolderPages + 1; // + spliced invoice
if (
  report.footerTotals.length !== 1 ||
  Number(report.footerTotals[0]) !== expectedTotal
)
  failures.push(
    `footer totals ${report.footerTotals.join(",")} != expected ${expectedTotal} (holder ${report.totalHolderPages} + invoice 1)`,
  );

console.log(
  failures.length === 0
    ? `\nBODY SECTION: OK (${report.bodyCardCount} full-page cards = job's base readings; no ₹ in report; footers "of ${report.footerTotals[0]}")`
    : `\nBODY SECTION: FAIL\n  - ${failures.join("\n  - ")}`,
);
await browser.close();
if (failures.length) process.exit(1);
