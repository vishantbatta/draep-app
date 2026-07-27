import { chromium } from "playwright";

const BASE = "http://localhost:3002";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("→ Navigating to", `${BASE}/style`);
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for first hero image to be present in DOM
  await page.waitForSelector("img[src*='picsum.photos/seed/notion-']", { timeout: 15000 });

  // Scroll through the grid to force all images to lazy-load
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const sc = document.querySelector(".overflow-y-auto");
      if (sc) sc.scrollBy(0, 600);
    });
    await page.waitForTimeout(500);
  }

  // Wait for images to actually paint (all complete)
  await page.waitForFunction(
    () => {
      const imgs = Array.from(document.querySelectorAll("img[src*='picsum.photos/seed/notion-']"));
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    },
    { timeout: 30000 },
  ).catch(() => {});

  await page.waitForTimeout(2000);

  // Count + first 3 names
  const heroCount = await page.locator("img[src*='picsum.photos/seed/notion-']").count();
  const paintedCount = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img[src*='picsum.photos/seed/notion-']"));
    return imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
  });
  console.log("  notion hero images in DOM:", heroCount);
  console.log("  painted (naturalWidth > 0):", paintedCount);

  await page.screenshot({ path: "/tmp/style-painted.png", fullPage: true });
  console.log("  screenshot: /tmp/style-painted.png");

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
