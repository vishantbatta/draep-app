// COMPLETE FROM-SCRATCH UI TEST
// Fresh browser context, no localStorage, no cookies
// Goes through the EXACT flow a real user would take

import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Helper: wait for an element and click it
async function waitAndClick(page, selector, options = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: options.timeout ?? 10000 });
  await sleep(options.delay ?? 300);
  await el.click({ force: options.force ?? false });
  return el;
}

// Helper: fill a field
async function fillField(page, selector, value) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 5000 });
  await el.fill(value);
}

// ════════════════════════════════════════════════════════════════
// MAIN TEST
// ════════════════════════════════════════════════════════════════

const browser = await chromium.launch({ headless: false, slowMo: 200 });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone-like
});
const page = await context.newPage();

// Track ALL API calls
const apiLog = [];
page.on("request", (req) => {
  if (req.url().includes("/api/v1/") && !req.url().includes("OPTIONS")) {
    const isRelevant =
      req.url().includes("orders") ||
      req.url().includes("otp") ||
      req.url().includes("contact") ||
      req.url().includes("session") ||
      req.url().includes("anonymous");
    if (isRelevant) {
      apiLog.push({
        method: req.method(),
        url: req.url().replace("http://localhost:8000/api/v1", ""),
        body: req.postData()?.slice(0, 200),
      });
    }
  }
});

page.on("response", async (res) => {
  const url = res.url();
  if (url.includes("/api/v1/") && !url.includes("OPTIONS")) {
    const isRelevant =
      url.includes("orders") ||
      url.includes("otp") ||
      url.includes("contact") ||
      url.includes("session");
    if (isRelevant && (res.request().method() === "POST" || res.request().method() === "PUT")) {
      try {
        const body = await res.text();
        console.log(
          `  [API] ${res.request().method()} ${url.replace("http://localhost:8000/api/v1", "")} → ${res.status()} ${body.slice(0, 200)}`,
        );
      } catch {}
    }
  }
});

try {
  console.log("\n═════════════════════════════════════════════");
  console.log("  FROM-SCRATCH UI TEST");
  console.log("═════════════════════════════════════════════\n");

  // ── STEP 1: Load home page first (to bootstrap anonymous session) ─
  console.log("STEP 1: Loading home page (fresh context)...");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("  URL:", page.url());

  // ── STEP 2: Navigate to /style page ────────────────────────────
  console.log("\nSTEP 2: Navigate to /style page...");
  await page.goto(`${BASE}/style`, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("  URL:", page.url());

  // Click "Build from scratch" on the style landing page
  const scratchSelectors = [
    'button:has-text("scratch")',
    'a:has-text("scratch")',
    'text=Build from scratch',
  ];

  let clicked = false;
  for (const sel of scratchSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 })) {
        await sleep(500);
        await el.click();
        clicked = true;
        console.log(`  Clicked: ${sel}`);
        break;
      }
    } catch {}
  }

  if (!clicked) {
    await page.screenshot({ path: "/tmp/scratch-style-landing.png" });
    const bodyText = await page.locator("body").textContent();
    console.log("  Page text (first 800):", bodyText?.slice(0, 800));
    // If we're already on a style sub-page, that's fine
    if (page.url().includes("/style/")) {
      clicked = true;
      console.log("  Already on style sub-page");
    }
  }

  // Wait for navigation to /design/cut (handleBuildFromScratch is async)
  console.log("  Waiting for navigation to /design/...");
  try {
    await page.waitForURL("**/design/**", { timeout: 15000 });
  } catch {
    console.log("  URL:", page.url());
    await page.screenshot({ path: "/tmp/scratch-after-build.png" });
  }
  await sleep(2000);
  console.log("  URL:", page.url());

  // ── STEP 3: Skip design steps — go directly to /review ─────────
  console.log("\nSTEP 3: Navigate to /review...");
  await page.goto(`${BASE}/review`, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("  URL:", page.url());

  // If redirected back to a design page (middleware requires draft),
  // we need to flush selections first
  if (page.url().includes("/design/")) {
    console.log("  Redirected to design page — flushing selections...");
    // Navigate through each design step quickly by clicking Next
    for (let i = 0; i < 7; i++) {
      const currentUrl = page.url();
      console.log(`  Step ${i + 1}: ${currentUrl}`);
      if (!currentUrl.includes("/design/")) break;

      const nextBtn = page.locator('button:has-text("Next")').first();
      try {
        await nextBtn.waitFor({ state: "visible", timeout: 3000 });
        await sleep(500);
        await nextBtn.click({ force: true });
        await sleep(2000);
      } catch {
        break;
      }
    }
    await sleep(2000);
    console.log("  URL after stepping:", page.url());
  }

  // ── STEP 5: On contact page — fill form ────────────────────────
  console.log("\nSTEP 4: Go to /contact and fill form...");
  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await sleep(3000);

  console.log("  URL:", page.url());

  // Wait for form to be ready
  await page.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 10000 });

  // Fill fields
  await fillField(page, 'input[autocomplete="tel-national"]', "9876543210");
  await fillField(page, 'input[autocomplete="name"]', "Scratch Test");
  await fillField(page, 'input[autocomplete="address-line1"]', "100 MG Road");
  await fillField(page, 'input[autocomplete="postal-code"]', "560001");
  console.log("  Form filled");

  // Set map pin — click center of map
  const mapSelectors = [
    ".leaflet-container",
    ".leaflet-map-pane",
    '[class*="map"]',
    '[class*="Map"]',
  ];

  let mapClicked = false;
  for (const sel of mapSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) {
        const box = await el.boundingBox();
        if (box) {
          await el.click({ position: { x: box.width / 2, y: box.height / 2 } });
          mapClicked = true;
          console.log(`  Clicked map: ${sel}`);
          break;
        }
      }
    } catch {}
  }

  if (!mapClicked) {
    console.log("  ⚠ Could not click map — checking if pin is required...");
    await page.screenshot({ path: "/tmp/scratch-contact-no-map.png" });
  }

  await sleep(2000);

  // Check for "out of area" error
  const outOfArea = await page
    .locator('[class*="Banner"], [class*="error"], [class*="Error"]')
    .first()
    .isVisible()
    .catch(() => false);

  if (outOfArea) {
    const errText = await page.locator('[class*="Banner"]').first().textContent();
    console.log("  ⚠ Banner visible:", errText?.trim().slice(0, 200));
  }

  // ── STEP 6: Submit form ────────────────────────────────────────
  console.log("\nSTEP 6: Submit contact form...");
  await waitAndClick(page, 'button[type="submit"]', { force: true });
  await sleep(3000);
  console.log("  URL after submit:", page.url());

  // Should redirect to /otp
  if (!page.url().includes("/otp")) {
    await page.screenshot({ path: "/tmp/scratch-after-submit.png" });
    const bodyText = await page.locator("body").textContent();
    console.log("  Body:", bodyText?.slice(0, 300));
    throw new Error(`Expected /otp, got ${page.url()}`);
  }

  // ── STEP 7: Enter OTP and verify ───────────────────────────────
  console.log("\nSTEP 7: Enter OTP...");
  await sleep(2000);

  // Wait for OTP input
  const otpInput = page.locator('input[inputmode="numeric"]').first();
  await otpInput.waitFor({ state: "visible", timeout: 10000 });
  await otpInput.fill("123456");
  console.log("  OTP entered: 123456");

  // Click verify
  const verifyBtn = page.locator('button:has-text("Verify")').first();
  await verifyBtn.waitFor({ state: "visible", timeout: 5000 });
  await verifyBtn.click();
  console.log("  Verify clicked");

  // Wait for navigation
  await sleep(4000);
  console.log("  URL after OTP verify:", page.url());

  // ── STEP 8: Back on /contact (authenticated) ───────────────────
  if (!page.url().includes("/contact")) {
    await page.screenshot({ path: "/tmp/scratch-after-otp.png" });
    throw new Error(`Expected /contact after OTP, got ${page.url()}`);
  }

  console.log("\nSTEP 8: Back on contact page (authenticated)");

  // Wait for form to load
  await page.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 5000 });
  await sleep(500);

  // Re-fill form (data might be preserved from before)
  await fillField(page, 'input[autocomplete="tel-national"]', "9876543210");
  await fillField(page, 'input[autocomplete="name"]', "Scratch Test");
  await fillField(page, 'input[autocomplete="address-line1"]', "100 MG Road");
  await fillField(page, 'input[autocomplete="postal-code"]', "560001");

  // Re-click map
  for (const sel of mapSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        const box = await el.boundingBox();
        if (box) {
          await el.click({ position: { x: box.width / 2, y: box.height / 2 } });
          console.log("  Map re-clicked");
          break;
        }
      }
    } catch {}
  }

  await sleep(2000);

  // ── STEP 9: Submit again (this is where the error happens) ─────
  console.log("\nSTEP 9: Submit contact form (authenticated)...");

  // Capture the PUT response
  const putResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/contact") && res.request().method() === "PUT",
    { timeout: 15000 },
  );

  await page.locator('button[type="submit"]').first().click({ force: true });

  const putResponse = await putResponsePromise;
  const putStatus = putResponse.status();
  const putBody = await putResponse.text();

  console.log(`  PUT /contact → ${putStatus}`);
  console.log(`  Response: ${putBody.slice(0, 300)}`);

  if (putStatus >= 400) {
    console.error(`\n✗✗✗ ERROR REPRODUCED: ${putStatus} ${putBody.slice(0, 200)}`);
    await page.screenshot({ path: "/tmp/scratch-error.png" });

    // Check localStorage state
    const ls = await page.evaluate(() => {
      return {
        auth: JSON.parse(localStorage.getItem("draep-auth") || "{}"),
        draft: JSON.parse(localStorage.getItem("draep-booking-draft") || "{}"),
        token: localStorage.getItem("draep_session_token"),
      };
    });
    console.log("\n  localStorage state:");
    console.log("    auth token type:", ls.auth?.state?.sessionType);
    console.log("    auth activeOrderId:", ls.auth?.state?.activeOrderId);
    console.log("    draft orderId:", ls.draft?.state?.draft?.orderId);

    throw new Error(`PUT contact failed with ${putStatus}: ${putBody.slice(0, 200)}`);
  }

  // ── STEP 10: Check navigation ──────────────────────────────────
  await sleep(3000);
  console.log("\n  URL after PUT:", page.url());

  if (page.url().includes("/pay") || page.url().includes("/slot") || page.url().includes("/booking")) {
    console.log("\n═════════════════════════════════════════════");
    console.log("  ✓✓✓ SUCCESS — Reached next page!");
    console.log("═════════════════════════════════════════════");
  } else {
    await page.screenshot({ path: "/tmp/scratch-stuck.png" });
    console.log("  ⚠ Stuck on:", page.url());

    // Check for error banner
    const errorVisible = await page
      .locator('[class*="Banner-variant-error"], [class*="error"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (errorVisible) {
      const errorText = await page
        .locator('[class*="Banner-variant-error"], [class*="error"]')
        .first()
        .textContent();
      console.log("  Error banner:", errorText?.trim());
    }

    throw new Error(`Did not reach /pay, got ${page.url()}`);
  }

  console.log("\n  API log:");
  for (const c of apiLog) {
    console.log(`    ${c.method} ${c.url} ${c.body ? "→ " + c.body.slice(0, 100) : ""}`);
  }
} catch (err) {
  console.error("\n✗ TEST FAILED:", err.message);
  await page.screenshot({ path: "/tmp/scratch-fail.png" }).catch(() => {});
  throw err;
} finally {
  await browser.close();
}
