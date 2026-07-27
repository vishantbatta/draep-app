import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

  console.log("→ Navigating to", `${BASE}/style`);
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("img", { timeout: 20000 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // Screenshot grid page
  await page.screenshot({ path: "/tmp/style-grid.png", fullPage: false });
  console.log("✓ Grid screenshot saved to /tmp/style-grid.png");

  // Check aspect ratio of first card image
  const dims = await page.$$eval("img", els => {
    const visible = els.filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 50 && r.height > 50;
    });
    if (!visible.length) return null;
    const r = visible[0].getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), ratio: (r.width / r.height).toFixed(2) };
  });
  console.log("First card image dims:", JSON.stringify(dims));
  // Expected ratio ~1.78 (16:9)

  // Click first card to open bottom sheet
  const firstCard = await page.$("button:has(img)");
  if (firstCard) {
    await firstCard.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/style-sheet.png", fullPage: false });
    console.log("✓ Sheet screenshot saved to /tmp/style-sheet.png");

    // Click the zoom button on the hero image inside the sheet
    const zoomBtn = await page.$('button[aria-label="Zoom image"]');
    if (zoomBtn) {
      await zoomBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "/tmp/style-zoom.png", fullPage: false });
      console.log("✓ Zoom screenshot saved to /tmp/style-zoom.png");
    } else {
      console.log("⚠ No zoom button found in sheet");
    }
  } else {
    console.log("⚠ No card found to click");
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
