import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const PHONE = "9000000102";
const PASSWORD = "style_captain_2";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(`PAGEERROR: ${err.message}`);
  });

  // 1. Go to login page
  console.log("→ Navigating to SC dashboard (should redirect to login)…");
  await page.goto(`${BASE}/style_captain_dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log("  URL:", page.url());

  // 2. Login
  console.log("→ Logging in as Rohan Desai…");
  await page.waitForSelector('input[type="tel"], input[type="text"], input[name="phone"], input[placeholder*="phone" i]', { timeout: 10000 }).catch(() => {});
  // Try to find inputs
  const phoneInput = await page.$('input[name="phone"]') || await page.$('input[type="tel"]') || await page.$('input[type="text"]');
  const passwordInput = await page.$('input[name="password"]') || await page.$('input[type="password"]');

  if (phoneInput && passwordInput) {
    await phoneInput.fill(PHONE);
    await passwordInput.fill(PASSWORD);
    // Find and click submit button
    const submitBtn = await page.$('button[type="submit"]') || await page.$('button:not([type="button"])');
    if (submitBtn) {
      await submitBtn.click();
    }
    await page.waitForTimeout(3000);
    console.log("  URL after login:", page.url());
  } else {
    console.log("  Could not find login inputs, dumping HTML…");
    const html = await page.content();
    console.log(html.slice(0, 2000));
  }

  // 3. Should be on dashboard now — check for the schedule banner
  console.log("→ Checking dashboard for schedule banner…");
  await page.waitForTimeout(2000);

  // Screenshot the full page
  await page.screenshot({ path: "/tmp/sc-dashboard.png", fullPage: true });
  console.log("  Screenshot saved: /tmp/sc-dashboard.png");

  // Check for "My Schedule" text
  const scheduleBanner = await page.$("text=My Schedule");
  console.log("  'My Schedule' banner found:", !!scheduleBanner);

  // Check for "Start a Measurement" text
  const startBtn = await page.$("text=Start a Measurement");
  console.log("  'Start a Measurement' button found:", !!startBtn);

  // 4. Click the schedule banner
  if (scheduleBanner) {
    console.log("→ Clicking schedule banner…");
    await scheduleBanner.click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: "/tmp/sc-schedule-panel.png", fullPage: true });
    console.log("  Screenshot saved: /tmp/sc-schedule-panel.png");

    // Check for sub-tabs
    const scheduleTab = await page.$("text=Schedule");
    const holidaysTab = await page.$("text=Holidays");
    const extraSlotsTab = await page.$("text=Extra Slots");
    const previewTab = await page.$("text=Preview");
    console.log("  Sub-tabs found:", {
      schedule: !!scheduleTab,
      holidays: !!holidaysTab,
      extraSlots: !!extraSlotsTab,
      preview: !!previewTab,
    });

    // 5. Click "Preview" sub-tab
    if (previewTab) {
      console.log("→ Clicking Preview tab…");
      await previewTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "/tmp/sc-preview.png", fullPage: true });
      console.log("  Screenshot saved: /tmp/sc-preview.png");
    }

    // 6. Click "Holidays" sub-tab
    if (holidaysTab) {
      console.log("→ Clicking Holidays tab…");
      await holidaysTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "/tmp/sc-holidays.png", fullPage: true });
      console.log("  Screenshot saved: /tmp/sc-holidays.png");
    }

    // 7. Click "Extra Slots" sub-tab
    if (extraSlotsTab) {
      console.log("→ Clicking Extra Slots tab…");
      await extraSlotsTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "/tmp/sc-slots.png", fullPage: true });
      console.log("  Screenshot saved: /tmp/sc-slots.png");
    }

    // 8. Close the panel
    console.log("→ Closing schedule panel…");
    const closeBtn = await page.$('button[aria-label="Close schedule"]');
    if (closeBtn) {
      await closeBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  // Report console errors
  console.log("\n=== Console errors ===");
  if (consoleErrors.length === 0) {
    console.log("  (none)");
  } else {
    for (const e of consoleErrors) {
      console.log("  ", e);
    }
  }

  await browser.close();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
