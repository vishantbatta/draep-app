import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("→ Navigating to", `${BASE}/style`);
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for any image to render
  await page.waitForSelector("img", { timeout: 20000 });

  // Scroll to trigger lazy load
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  const imgs = await page.$$eval("img", els =>
    els.map(e => e.src).filter(Boolean)
  );
  const replicate = imgs.filter(s => s.includes("replicate.delivery"));
  const picsum = imgs.filter(s => s.includes("picsum.photos"));
  console.log("Total imgs:", imgs.length);
  console.log("Replicate imgs:", replicate.length);
  console.log("Picsum imgs:", picsum.length);
  if (replicate.length > 0) {
    console.log("First Replicate URL:", replicate[0]);
  }
  if (picsum.length > 0) {
    console.log("First picsum URL:", picsum[0]);
  }
  console.log(replicate.length >= 20 ? "PASS" : "FAIL");
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
