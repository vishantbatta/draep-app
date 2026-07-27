// RETURNING USER TEST: Simulates a user who completed a flow before,
// comes back later with stale localStorage, and tries to book again.
// This is the EXACT scenario that causes "Order not found".

import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const browser = await chromium.launch({ headless: false, slowMo: 100 });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const page = await context.newPage();

// Track API calls
page.on("response", async (res) => {
  const url = res.url();
  if (
    url.includes("/api/v1/") &&
    !url.includes("OPTIONS") &&
    (res.request().method() === "POST" || res.request().method() === "PUT")
  ) {
    try {
      const body = await res.text();
      console.log(
        `  [API] ${res.request().method()} ${url.replace("http://localhost:8000/api/v1", "")} → ${res.status()} ${body.slice(0, 200)}`,
      );
    } catch {}
  }
});

try {
  console.log("\n═════════════════════════════════════════════");
  console.log("  RETURNING USER TEST");
  console.log("═════════════════════════════════════════════\n");

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: Complete a full flow (creates order, OTP, contact)
  // ═══════════════════════════════════════════════════════════════
  console.log("PHASE 1: Initial flow (simulating previous session)\n");

  console.log("1. Load home + navigate to /style...");
  await page.goto(BASE, { waitUntil: "networkidle" });
  await sleep(2000);
  await page.goto(`${BASE}/style`, { waitUntil: "networkidle" });
  await sleep(2000);

  // Click "Build from scratch"
  const scratchBtn = page.locator('button:has-text("scratch")').first();
  await scratchBtn.waitFor({ state: "visible", timeout: 5000 });
  await sleep(500);
  await scratchBtn.click();

  // Wait for navigation
  try {
    await page.waitForURL("**/design/**", { timeout: 15000 });
  } catch {
    console.log("  URL:", page.url());
  }
  await sleep(2000);
  console.log("  On design page:", page.url());

  // Skip to contact
  console.log("2. Navigate to /contact...");
  await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("  URL:", page.url());

  // Fill contact form
  console.log("3. Fill contact form...");
  await page.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 5000 });
  await page.locator('input[autocomplete="tel-national"]').fill("9876543210");
  await page.locator('input[autocomplete="name"]').fill("Phase 1 User");
  await page.locator('input[autocomplete="address-line1"]').fill("123 MG Road");
  await page.locator('input[autocomplete="postal-code"]').fill("560001");

  // Click map
  const map = page.locator(".leaflet-container").first();
  if (await map.isVisible()) {
    const box = await map.boundingBox();
    if (box) await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await sleep(1500);
  }

  // Submit → OTP
  console.log("4. Submit → OTP...");
  await page.locator('button[type="submit"]').click({ force: true });
  await sleep(3000);

  if (!page.url().includes("/otp")) {
    throw new Error(`Expected /otp, got ${page.url()}`);
  }

  // Enter OTP
  console.log("5. Enter OTP...");
  await sleep(1500);
  const otpInput = page.locator('input[inputmode="numeric"]').first();
  await otpInput.waitFor({ state: "visible", timeout: 5000 });
  await otpInput.fill("123456");
  await page.locator('button:has-text("Verify")').click();
  await sleep(4000);
  console.log("  After OTP:", page.url());

  // Should be on /contact (authenticated)
  if (!page.url().includes("/contact")) {
    throw new Error(`Expected /contact after OTP, got ${page.url()}`);
  }

  // Re-fill and submit
  console.log("6. Re-fill and submit (authenticated)...");
  await page.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 5000 });
  await page.locator('input[autocomplete="tel-national"]').fill("9876543210");
  await page.locator('input[autocomplete="name"]').fill("Phase 1 User");
  await page.locator('input[autocomplete="address-line1"]').fill("123 MG Road");
  await page.locator('input[autocomplete="postal-code"]').fill("560001");

  const map2 = page.locator(".leaflet-container").first();
  if (await map2.isVisible()) {
    const box = await map2.boundingBox();
    if (box) await map2.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await sleep(1500);
  }

  const putResponse1 = page.waitForResponse(
    (res) => res.url().includes("/contact") && res.request().method() === "PUT",
    { timeout: 15000 },
  );
  await page.locator('button[type="submit"]').click({ force: true });
  const putRes1 = await putResponse1;
  console.log(`  PUT contact: ${putRes1.status()}`);

  if (putRes1.status() >= 400) {
    const body = await putRes1.text();
    throw new Error(`Phase 1 PUT failed: ${putRes1.status()} ${body.slice(0, 200)}`);
  }
  console.log("  ✓ Phase 1 complete!\n");

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: Simulate returning user
  // Close the "browser" and open a new one with SAME localStorage
  // ═══════════════════════════════════════════════════════════════
  console.log("PHASE 2: Returning user (same localStorage, new session)\n");

  // Save localStorage state
  const lsState = await page.evaluate(() => {
    return {
      auth: localStorage.getItem("draep-auth"),
      draft: localStorage.getItem("draep-booking-draft"),
      token: localStorage.getItem("draep_session_token"),
    };
  });
  console.log("  Saved localStorage:");
  console.log("    draft orderId:", JSON.parse(lsState.draft || "{}")?.state?.draft?.orderId);
  console.log("    auth sessionType:", JSON.parse(lsState.auth || "{}")?.state?.sessionType);

  // Close current page and create a new one with the SAME localStorage
  await page.close();

  const page2 = await context.newPage();

  // Inject the localStorage from phase 1
  await page2.addInitScript((ls) => {
    localStorage.setItem("draep-auth", ls.auth);
    localStorage.setItem("draep-booking-draft", ls.draft);
    if (ls.token) localStorage.setItem("draep_session_token", ls.token);
    // Set the draft cookie too
    document.cookie = "draep_draft=1; path=/; SameSite=Lax";
  }, lsState);

  // Track API for page2
  page2.on("response", async (res) => {
    const url = res.url();
    if (
      url.includes("/api/v1/") &&
      !url.includes("OPTIONS") &&
      (res.request().method() === "POST" || res.request().method() === "PUT")
    ) {
      try {
        const body = await res.text();
        console.log(
          `  [API] ${res.request().method()} ${url.replace("http://localhost:8000/api/v1", "")} → ${res.status()} ${body.slice(0, 200)}`,
        );
      } catch {}
    }
  });

  // Load the app with existing localStorage
  console.log("7. Load app with existing localStorage...");
  await page2.goto(BASE, { waitUntil: "networkidle" });
  await sleep(3000);

  // Check what the app bootstrapped with
  const lsCheck = await page2.evaluate(() => {
    return {
      auth: JSON.parse(localStorage.getItem("draep-auth") || "{}"),
      draft: JSON.parse(localStorage.getItem("draep-booking-draft") || "{}"),
    };
  });
  console.log("  After bootstrap:");
  console.log("    sessionType:", lsCheck.auth?.state?.sessionType);
  console.log("    draft orderId:", lsCheck.draft?.state?.draft?.orderId);

  // Navigate directly to /contact
  console.log("\n8. Navigate to /contact...");
  await page2.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("  URL:", page2.url());

  // Check if already authenticated
  const sessionType = lsCheck.auth?.state?.sessionType;
  console.log("  sessionType:", sessionType);

  // Fill and submit
  console.log("\n9. Fill contact form...");
  await page2.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 5000 });
  await page2.locator('input[autocomplete="tel-national"]').fill("9876543210");
  await page2.locator('input[autocomplete="name"]').fill("Returning User");
  await page2.locator('input[autocomplete="address-line1"]').fill("456 Indiranagar");
  await page2.locator('input[autocomplete="postal-code"]').fill("560038");

  const map3 = page2.locator(".leaflet-container").first();
  if (await map3.isVisible()) {
    const box = await map3.boundingBox();
    if (box) await map3.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await sleep(1500);
  }

  if (sessionType !== "user") {
    // Need to go through OTP again
    console.log("  Not authenticated → will redirect to OTP");
    await page2.locator('button[type="submit"]').click({ force: true });
    await sleep(3000);
    console.log("  URL:", page2.url());

    if (page2.url().includes("/otp")) {
      console.log("\n10. Enter OTP...");
      await sleep(1500);
      const otpInput2 = page2.locator('input[inputmode="numeric"]').first();
      await otpInput2.waitFor({ state: "visible", timeout: 5000 });
      await otpInput2.fill("123456");
      await page2.locator('button:has-text("Verify")').click();
      await sleep(4000);
      console.log("  After OTP:", page2.url());

      if (!page2.url().includes("/contact")) {
        throw new Error(`Expected /contact after OTP, got ${page2.url()}`);
      }

      // Re-fill form
      console.log("\n11. Re-fill contact form (authenticated)...");
      await page2.locator('input[autocomplete="tel-national"]').waitFor({ state: "visible", timeout: 5000 });
      await page2.locator('input[autocomplete="tel-national"]').fill("9876543210");
      await page2.locator('input[autocomplete="name"]').fill("Returning User");
      await page2.locator('input[autocomplete="address-line1"]').fill("456 Indiranagar");
      await page2.locator('input[autocomplete="postal-code"]').fill("560038");

      const map4 = page2.locator(".leaflet-container").first();
      if (await map4.isVisible()) {
        const box = await map4.boundingBox();
        if (box) await map4.click({ position: { x: box.width / 2, y: box.height / 2 } });
        await sleep(1500);
      }
    }
  }

  // Final submit
  console.log("\n12. Submit contact form (authenticated)...");
  const putPromise = page2.waitForResponse(
    (res) => res.url().includes("/contact") && res.request().method() === "PUT",
    { timeout: 15000 },
  );
  await page2.locator('button[type="submit"]').click({ force: true });
  const putRes = await putPromise;
  const putStatus = putRes.status();
  const putBody = await putRes.text();

  console.log(`\n  PUT /contact → ${putStatus}`);
  console.log(`  Response: ${putBody.slice(0, 300)}`);

  if (putStatus >= 400) {
    console.error("\n✗✗✗ ERROR REPRODUCED!");
    await page2.screenshot({ path: "/tmp/returning-error.png" });

    // Check localStorage
    const lsFinal = await page2.evaluate(() => ({
      auth: JSON.parse(localStorage.getItem("draep-auth") || "{}"),
      draft: JSON.parse(localStorage.getItem("draep-booking-draft") || "{}"),
    }));
    console.log("\n  localStorage:");
    console.log("    sessionType:", lsFinal.auth?.state?.sessionType);
    console.log("    activeOrderId:", lsFinal.auth?.state?.activeOrderId);
    console.log("    draft orderId:", lsFinal.draft?.state?.draft?.orderId);
    throw new Error(`PUT contact failed: ${putStatus}`);
  }

  await sleep(3000);
  console.log("\n  Final URL:", page2.url());

  if (page2.url().includes("/pay") || page2.url().includes("/slot")) {
    console.log("\n═════════════════════════════════════════════");
    console.log("  ✓✓✓ SUCCESS — Returning user flow works!");
    console.log("═════════════════════════════════════════════");
  } else {
    throw new Error(`Expected /pay, got ${page2.url()}`);
  }
} catch (err) {
  console.error("\n✗ TEST FAILED:", err.message);
  throw err;
} finally {
  await browser.close();
}
