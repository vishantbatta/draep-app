import { chromium } from "playwright";

const BASE = "http://localhost:3002";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGEERROR: ${err.message}`);
  });
  page.on("response", async (resp) => {
    if (resp.status() >= 400) {
      failedRequests.push(`${resp.status()} ${resp.url()}`);
    }
  });
  page.on("requestfinished", async (req) => {
    if (req.url().includes("/library")) {
      const resp = await req.response();
      console.log(`  [library req] ${resp?.status()} ${req.url()}`);
    }
  });

  console.log("→ Navigating to", `${BASE}/style`);
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for at least one design image to render, with timeout
  try {
    await page.waitForSelector("img[src*='picsum.photos/seed/notion-']", { timeout: 15000 });
    console.log("  hero image rendered!");
  } catch (e) {
    console.log("  ! hero image did not appear in 15s");
  }

  // Final snapshot
  await page.waitForTimeout(2000);

  const heroImgs = await page.locator("img[src*='picsum.photos/seed/notion-']").count();
  const aishText = await page.locator("text=Aishwarya").first().count();
  console.log("  notion hero images:", heroImgs);
  console.log("  'Aishwarya' text found:", aishText === 1);

  await page.screenshot({ path: "/tmp/style-final.png", fullPage: true });
  console.log("  screenshot: /tmp/style-final.png");

  console.log("\n=== Failed requests ===");
  failedRequests.forEach((r) => console.log("  ", r));
  if (!failedRequests.length) console.log("  (none)");

  console.log("\n=== Console errors ===");
  consoleErrors.forEach((e) => console.log("  ", e));
  if (!consoleErrors.length) console.log("  (none)");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
