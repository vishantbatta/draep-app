// Full flow test: fresh session + returning user with stale localStorage
// Tests the exact "Order not found" bug scenario

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runTest(name, fn) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log("=".repeat(60));
  try {
    await fn();
    console.log(`✓ PASSED: ${name}`);
  } catch (err) {
    console.error(`✗ FAILED: ${name}`);
    console.error(`  ${err.message}`);
    process.exitCode = 1;
  }
}

const browser = await chromium.launch({ headless: true });

// ═══════════════════════════════════════════════════════════════
// TEST 1: Fresh session — should work end-to-end
// ═══════════════════════════════════════════════════════════════
await runTest("Fresh session flow", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Capture API responses
  const apiCalls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/v1/")) {
      const status = res.status();
      let body = "";
      try {
        body = await res.text();
      } catch {}
      apiCalls.push({ url: url.replace(API, ""), status, body: body.slice(0, 300) });
    }
  });

  console.log("  → Loading home page...");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(2000);

  // Click "Build from scratch"
  console.log("  → Clicking 'Build from scratch'...");
  const scratchBtn = page.locator('button:has-text("Build from scratch"), a:has-text("Build from scratch")');
  await scratchBtn.first().waitFor({ state: "visible", timeout: 10000 });
  await sleep(500);
  await scratchBtn.first().click();
  await page.waitForURL("**/style/**", { timeout: 15000 });
  console.log("  → On style page");

  await sleep(2000);

  // Click Next to go to review
  console.log("  → Clicking Next...");
  const nextBtn = page.locator('button:has-text("Next")');
  await nextBtn.first().waitFor({ state: "visible", timeout: 10000 });
  await nextBtn.first().click({ force: true });
  await sleep(2000);

  // Should be on review or contact page
  console.log("  → Current URL:", page.url());

  // If on review, click Continue
  if (page.url().includes("/review")) {
    console.log("  → On review page, clicking Continue...");
    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")');
    if (await continueBtn.first().isVisible()) {
      await continueBtn.first().click({ force: true });
      await sleep(2000);
    }
  }

  // Should be on contact page now
  console.log("  → Current URL:", page.url());

  if (page.url().includes("/contact")) {
    console.log("  → Filling contact form...");

    // Fill phone
    const phoneInput = page.locator('input[autocomplete="tel-national"]');
    if (await phoneInput.isVisible()) {
      await phoneInput.fill("9876543210");
    }

    // Fill name
    const nameInput = page.locator('input[autocomplete="name"]');
    if (await nameInput.isVisible()) {
      await nameInput.fill("Test User");
    }

    // Fill address
    const addrInput = page.locator('input[autocomplete="address-line1"]');
    if (await addrInput.isVisible()) {
      await addrInput.fill("123 Test Street");
    }

    // Fill pincode
    const pinInput = page.locator('input[autocomplete="postal-code"]');
    if (await pinInput.isVisible()) {
      await pinInput.fill("560001");
    }

    // Click the map to set a pin (if map exists)
    const mapContainer = page.locator(".leaflet-container, [class*='map']");
    if (await mapContainer.first().isVisible().catch(() => false)) {
      await mapContainer.first().click({ position: { x: 100, y: 100 } });
      await sleep(1000);
    }

    // Submit
    console.log("  → Submitting contact form...");
    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();
    await sleep(2000);

    // Should redirect to /otp
    if (page.url().includes("/otp")) {
      console.log("  → On OTP page");

      // Wait for OTP to auto-send and field to appear
      await sleep(1500);

      // Fill OTP
      const otpInput = page.locator('input[inputmode="numeric"]');
      if (await otpInput.isVisible()) {
        await otpInput.fill("123456");

        // Click verify
        const verifyBtn = page.locator('button:has-text("Verify")');
        await verifyBtn.click();
        await sleep(3000);
      }

      console.log("  → After OTP, URL:", page.url());

      // Should be back on /contact (authenticated now)
      if (page.url().includes("/contact")) {
        console.log("  → Back on contact page, filling again...");

        // Re-fill the form (values may have been cleared)
        const phoneInput2 = page.locator('input[autocomplete="tel-national"]');
        if (await phoneInput2.isVisible()) {
          await phoneInput2.fill("9876543210");
        }
        const nameInput2 = page.locator('input[autocomplete="name"]');
        if (await nameInput2.isVisible()) {
          await nameInput2.fill("Test User");
        }
        const addrInput2 = page.locator('input[autocomplete="address-line1"]');
        if (await addrInput2.isVisible()) {
          await addrInput2.fill("123 Test Street");
        }
        const pinInput2 = page.locator('input[autocomplete="postal-code"]');
        if (await pinInput2.isVisible()) {
          await pinInput2.fill("560001");
        }

        // Set map pin
        const mapContainer2 = page.locator(".leaflet-container, [class*='map']");
        if (await mapContainer2.first().isVisible().catch(() => false)) {
          await mapContainer2.first().click({ position: { x: 100, y: 100 } });
          await sleep(1000);
        }

        // Submit again
        console.log("  → Submitting contact form (authenticated)...");
        const submitBtn2 = page.locator('button[type="submit"]');
        await submitBtn2.click();
        await sleep(3000);

        console.log("  → Final URL:", page.url());

        if (page.url().includes("/pay")) {
          console.log("  ✓ Reached /pay — SUCCESS!");
        } else if (page.url().includes("/slot")) {
          console.log("  ✓ Reached /slot — SUCCESS (different flow)!");
        } else {
          // Check for error banner
          const errorBanner = page.locator('[class*="error"], [class*="Banner"]');
          const errorText = await errorBanner.first().textContent().catch(() => "");
          if (errorText && errorText.trim()) {
            throw new Error(`Stuck on ${page.url()} with error: ${errorText.trim().slice(0, 200)}`);
          }
          throw new Error(`Expected /pay or /slot, got ${page.url()}`);
        }
      }
    }
  }

  // Print API calls for debugging
  console.log("\n  API calls:");
  for (const c of apiCalls) {
    if (c.url.includes("contact") || c.url.includes("otp") || c.url.includes("session")) {
      console.log(`    ${c.status} ${c.url} ${c.body ? "→ " + c.body.slice(0, 150) : ""}`);
    }
  }

  await ctx.close();
});

// ═══════════════════════════════════════════════════════════════
// TEST 2: Returning user with stale orderId in localStorage
// This simulates: user did a flow before, comes back, has stale data
// ═══════════════════════════════════════════════════════════════
await runTest("Returning user with stale orderId", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Inject stale localStorage BEFORE the page loads
  // This simulates a returning user who has old data in localStorage
  await page.addInitScript(() => {
    // Set up stale auth + booking data
    const oldOrderId = "00000000-0000-0000-0000-000000000000"; // fake/non-existent
    localStorage.setItem(
      "draep-booking-draft",
      JSON.stringify({
        state: {
          draft: {
            version: 1,
            orderId: oldOrderId,
            garmentId: null,
            selections: {},
            addOns: {},
            serverPriceBreakdown: null,
            updatedAt: new Date().toISOString(),
          },
          hydrated: false,
          syncing: false,
          syncError: null,
        },
        version: 1,
      }),
    );
    // No auth token → app will create anonymous session
  });

  // Capture API responses
  const apiCalls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/v1/")) {
      const status = res.status();
      let body = "";
      try {
        body = await res.text();
      } catch {}
      apiCalls.push({ url: url.replace(API, ""), status, body: body.slice(0, 300) });
    }
  });

  console.log("  → Loading home page with stale localStorage...");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3000);

  // Navigate directly to contact page (bypassing style flow)
  console.log("  → Navigating to /contact...");
  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await sleep(2000);

  console.log("  → Current URL:", page.url());

  // Check what orderId is in localStorage now
  const bookingData = await page.evaluate(() => {
    const raw = localStorage.getItem("draep-booking-draft");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  console.log("  → Booking draft orderId:", bookingData?.state?.draft?.orderId);

  // Fill contact form
  const phoneInput = page.locator('input[autocomplete="tel-national"]');
  if (await phoneInput.isVisible()) {
    await phoneInput.fill("9876543210");
  }
  const nameInput = page.locator('input[autocomplete="name"]');
  if (await nameInput.isVisible()) {
    await nameInput.fill("Returning User");
  }
  const addrInput = page.locator('input[autocomplete="address-line1"]');
  if (await addrInput.isVisible()) {
    await addrInput.fill("456 Return St");
  }
  const pinInput = page.locator('input[autocomplete="postal-code"]');
  if (await pinInput.isVisible()) {
    await pinInput.fill("560001");
  }

  // Click map
  const mapContainer = page.locator(".leaflet-container, [class*='map']");
  if (await mapContainer.first().isVisible().catch(() => false)) {
    await mapContainer.first().click({ position: { x: 100, y: 100 } });
    await sleep(1000);
  }

  // Submit
  console.log("  → Submitting contact form...");
  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();
  await sleep(2000);

  // Should redirect to OTP
  if (page.url().includes("/otp")) {
    console.log("  → On OTP page");
    await sleep(1500);

    const otpInput = page.locator('input[inputmode="numeric"]');
    if (await otpInput.isVisible()) {
      await otpInput.fill("123456");
      const verifyBtn = page.locator('button:has-text("Verify")');
      await verifyBtn.click();
      await sleep(3000);
    }

    console.log("  → After OTP, URL:", page.url());

    // Check orderId in localStorage after OTP verify
    const bookingData2 = await page.evaluate(() => {
      const raw = localStorage.getItem("draep-booking-draft");
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    });
    console.log("  → Booking orderId after OTP:", bookingData2?.state?.draft?.orderId);

    // Should be back on /contact
    if (page.url().includes("/contact")) {
      console.log("  → Back on contact page (authenticated)");

      // Check if there's an error
      const errorBanner = page.locator('[class*="Banner-variant-error"], [class*="error"]');
      const isVisible = await errorBanner.first().isVisible().catch(() => false);
      if (isVisible) {
        const errorText = await errorBanner.first().textContent();
        console.log("  ⚠ Error banner visible:", errorText?.trim().slice(0, 200));
      }

      // Re-fill form and submit
      const phoneInput2 = page.locator('input[autocomplete="tel-national"]');
      if (await phoneInput2.isVisible()) await phoneInput2.fill("9876543210");
      const nameInput2 = page.locator('input[autocomplete="name"]');
      if (await nameInput2.isVisible()) await nameInput2.fill("Returning User");
      const addrInput2 = page.locator('input[autocomplete="address-line1"]');
      if (await addrInput2.isVisible()) await addrInput2.fill("456 Return St");
      const pinInput2 = page.locator('input[autocomplete="postal-code"]');
      if (await pinInput2.isVisible()) await pinInput2.fill("560001");

      const mapContainer2 = page.locator(".leaflet-container, [class*='map']");
      if (await mapContainer2.first().isVisible().catch(() => false)) {
        await mapContainer2.first().click({ position: { x: 100, y: 100 } });
        await sleep(1000);
      }

      console.log("  → Submitting contact form (authenticated)...");
      const submitBtn2 = page.locator('button[type="submit"]');
      await submitBtn2.click();
      await sleep(4000);

      console.log("  → Final URL:", page.url());

      if (page.url().includes("/pay") || page.url().includes("/slot")) {
        console.log("  ✓ Reached payment/slot — SUCCESS!");
      } else {
        // Check for error
        const errBanner = page.locator('[class*="Banner-variant-error"]');
        const errVisible = await errBanner.first().isVisible().catch(() => false);
        if (errVisible) {
          const errText = await errBanner.first().textContent();
          throw new Error(`Failed on ${page.url()}: ${errText?.trim().slice(0, 200)}`);
        }
        throw new Error(`Expected /pay or /slot, got ${page.url()}`);
      }
    }
  } else {
    throw new Error(`Expected /otp redirect, got ${page.url()}`);
  }

  // Print relevant API calls
  console.log("\n  API calls:");
  for (const c of apiCalls) {
    if (c.url.includes("contact") || c.url.includes("otp") || c.url.includes("orders")) {
      console.log(`    ${c.status} ${c.url} ${c.body ? "→ " + c.body.slice(0, 150) : ""}`);
    }
  }

  await ctx.close();
});

await browser.close();
console.log("\nDone.");
