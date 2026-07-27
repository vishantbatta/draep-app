import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";

async function dumpAuth(page, label) {
  const ls = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  console.log(`\n--- localStorage @ ${label} ---`);
  for (const key of Object.keys(ls)) {
    if (key.includes("booking")) {
      try {
        const parsed = JSON.parse(ls[key]);
        const oid = parsed?.state?.draft?.orderId;
        if (oid) console.log(`  ${key}.orderId:`, oid);
      } catch {}
    }
    if (key.includes("auth") && key !== "draep_session_token") {
      try {
        const parsed = JSON.parse(ls[key]);
        console.log(`  ${key}.activeOrderId:`, parsed?.state?.activeOrderId ?? "none");
      } catch {}
    }
  }
}

async function clickPrimary(page) {
  const labels = ["Next", "Review", "Continue", "Verify & continue", "Continue to payment"];
  for (const label of labels) {
    const btns = await page.getByRole("button", { name: label, exact: true }).all();
    for (const b of btns) {
      if (await b.isVisible().catch(() => false)) {
        await b.click({ force: true });
        return true;
      }
    }
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("request", (req) => {
  if (req.url().includes("/api/v1/")) {
    const method = req.method();
    const url = req.url().replace(API, "");
    let body = req.postData() || "";
    if (body.length > 200) body = body.slice(0, 197) + "...";
    console.log(`>> ${method} ${url} ${body ? ":: " + body : ""}`);
  }
});

page.on("response", async (res) => {
  if (res.url().includes("/api/v1/")) {
    const method = res.request().method();
    const url = res.url().replace(API, "");
    const status = res.status();
    let body = "";
    try {
      const text = await res.text();
      body = text.length > 200 ? text.slice(0, 197) + "..." : text;
    } catch {}
    console.log(`[${status}] ${method} ${url} ${body ? ":: " + body : ""}`);
  }
});

try {
  // ═══════════════════════════════════════════════════════════════════
  // PHASE 1: Do a full flow to get a user token + orderId in localStorage
  // ═══════════════════════════════════════════════════════════════════
  console.log("=== PHASE 1: First complete flow ===");

  // Pre-warm
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("button")).some(
      (b) => b.textContent.trim() === "Build from scratch",
    ),
    { timeout: 15000 },
  );
  await page.waitForTimeout(1500);
  await page.locator("button", { hasText: "Build from scratch" }).first().click({ force: true });
  await page.waitForURL(/\/design\/cut/, { timeout: 15000 });
  console.log("At:", page.url());

  const designSteps = ["/design/length", "/design/front-neck", "/design/back", "/design/tying", "/design/fit", "/design/add-ons"];
  for (const path of designSteps) {
    await clickPrimary(page);
    const escaped = path.replace(/[\/]/g, "\\/");
    await page.waitForURL(new RegExp(escaped + "$"), { timeout: 15000 });
  }
  await clickPrimary(page);
  await page.waitForURL(/\/review/, { timeout: 10000 });
  await clickPrimary(page);
  await page.waitForURL(/\/contact/, { timeout: 10000 });
  console.log("At:", page.url());

  await page.locator('input[name="phone"]').fill("9876543210");
  await page.locator('input[name="name"]').fill("Test User");
  await page.locator('input[name="address1"]').fill("123 Test Street");
  await page.locator('input[name="pincode"]').fill("560001");
  await page.waitForTimeout(1000);
  await clickPrimary(page);
  await page.waitForURL(/\/otp/, { timeout: 10000 });
  console.log("At:", page.url());

  await page.locator('input[autocomplete="one-time-code"]').fill("123456");
  await page.getByRole("button", { name: /^Verify & continue$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/otp"), { timeout: 15000 });
  console.log("After OTP verify:", page.url());
  await dumpAuth(page, "after first OTP verify");

  // Now capture the localStorage state
  const lsState = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  const firstOrderId = JSON.parse(lsState["draep-booking-draft"])?.state?.draft?.orderId;
  console.log("\nFirst order ID:", firstOrderId);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 2: Now simulate the user returning for ANOTHER attempt.
  // The user's localStorage still has the old orderId, but they start a
  // NEW anonymous flow (new /style visit → new order created).
  // The OLD order may have been cancelled by the backend.
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== PHASE 2: Second flow (returning user) ===");

  // Clear auth token but KEEP the booking draft (simulates expired token)
  // Actually, let's simulate what really happens: user starts a new flow
  // with stale localStorage. The frontend creates a new anonymous session
  // but the old draft.orderId may still be in localStorage.
  //
  // The key scenario: user had an order from a previous session, it was
  // re-parented. Now they come back, the frontend creates a NEW order.
  // But wait — does the frontend clear the old draft or keep it?

  // Let's just navigate to /style again and see what happens:
  await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  await dumpAuth(page, "returning to /style");

  // Check: did the booking store keep the old orderId or create a new one?
  const lsState2 = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  const secondOrderId = JSON.parse(lsState2["draep-booking-draft"])?.state?.draft?.orderId;
  console.log("Second order ID:", secondOrderId);
  console.log("Same order?", firstOrderId === secondOrderId);

  // ═══════════════════════════════════════════════════════════════════
  // PHASE 3: Even worse scenario — user has a STALE orderId that was
  // already re-parented. They go through the flow WITHOUT creating a new
  // order (e.g. they navigate directly to /contact).
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n=== PHASE 3: Direct /contact with stale orderId ===");

  // Set up stale state: old orderId, user token
  await page.evaluate((oldOid) => {
    // Set the booking draft to use the old orderId
    const booking = JSON.parse(localStorage.getItem("draep-booking-draft") || "{}");
    if (booking?.state?.draft) {
      booking.state.draft.orderId = oldOid;
      localStorage.setItem("draep-booking-draft", JSON.stringify(booking));
    }
  }, firstOrderId);

  // Navigate to /contact directly
  await page.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  console.log("At:", page.url());
  await dumpAuth(page, "direct /contact with stale orderId");

  // Check what happens when we fill and submit
  const phoneVal = await page.locator('input[name="phone"]').inputValue().catch(() => "");
  if (!phoneVal) await page.locator('input[name="phone"]').fill("9876543210");
  const nameVal = await page.locator('input[name="name"]').inputValue().catch(() => "");
  if (!nameVal) await page.locator('input[name="name"]').fill("Test User");
  const addrVal = await page.locator('input[name="address1"]').inputValue().catch(() => "");
  if (!addrVal) await page.locator('input[name="address1"]').fill("123 Test Street");
  const pinVal = await page.locator('input[name="pincode"]').inputValue().catch(() => "");
  if (!pinVal) await page.locator('input[name="pincode"]').fill("560001");
  await page.waitForTimeout(1000);

  // Set up response listener for PUT
  const putResponsePromise = page.waitForResponse(
    (res) => res.url().includes("/contact") && res.request().method() === "PUT",
    { timeout: 15000 },
  ).catch(() => null);

  const submitBtn = page.getByRole("button", { name: /Continue to payment|Verify & continue/i });
  const isDisabled = await submitBtn.isDisabled().catch(() => "n/a");
  console.log("Submit disabled?", isDisabled);

  if (isDisabled !== true) {
    await submitBtn.click({ force: true });
    console.log("Clicked submit...");
    const putResponse = await putResponsePromise;
    if (putResponse) {
      console.log(`PUT /contact response: ${putResponse.status()}`);
      const body = await putResponse.text().catch(() => "");
      console.log(`PUT /contact body: ${body.slice(0, 300)}`);
    } else {
      console.log("No PUT response (form may have gone to /otp instead)");
    }
    await page.waitForTimeout(2000);
    console.log("Final URL:", page.url());

    const errBanner = await page.getByText(/Couldn't save|Order not found/i).count();
    console.log("Error banner count:", errBanner);
  } else {
    console.log("Submit was disabled — checking why...");
    const bannerTexts = await page.evaluate(() => {
      const els = document.querySelectorAll('[class*="banner"], [role="alert"], p');
      return Array.from(els).map(e => e.textContent.trim()).filter(t => t.length > 10 && t.length < 200);
    });
    console.log("Page texts:", JSON.stringify(bannerTexts.slice(0, 5)));
  }

} catch (err) {
  console.log("\nSCRIPT ERROR:", err.message);
  console.log("Current URL:", page.url());
} finally {
  await browser.close();
}
