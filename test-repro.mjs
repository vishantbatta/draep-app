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
  for (const [k, v] of Object.entries(ls)) {
    const short = k.length > 40 ? k.slice(0, 37) + "…" : k;
    const val = v && v.length > 80 ? v.slice(0, 77) + "…" : v;
    console.log(`  ${short} : ${val}`);
  }
  // Also parse the booking store for orderId
  // Parse booking store for orderId (key is draep-booking-draft)
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

// Intercept all API calls
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

page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`[console:error] ${msg.text()}`);
});

try {
  // ── Step 1: /style → Build from scratch ──
  console.log("\n=== 1. /style ===");
  let loaded = false;
  for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
    if (attempt > 0) { console.log(`Retry ${attempt}`); await page.waitForTimeout(2000); }
    await page.goto(`${BASE}/style`, { waitUntil: "domcontentloaded" });
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent.trim() === "Build from scratch",
        ),
        { timeout: 15000 },
      );
      loaded = true;
    } catch {}
  }
  if (!loaded) throw new Error("Could not load /style");

  // Wait for React hydration — button exists in DOM but onClick may not
  // be wired up yet. Give it time after the button appears.
  await page.waitForTimeout(1500);
  // Click "Build from scratch" using Playwright click with force
  const buildBtn = page.locator("button", { hasText: "Build from scratch" }).first();
  await buildBtn.click({ force: true });
  await page.waitForURL(/\/design\/cut/, { timeout: 15000 });
  console.log("At:", page.url());
  await page.waitForTimeout(500);
  await dumpAuth(page, "after /style");

  // ── Step 2: Walk through design pages ──
  const designSteps = ["/design/length", "/design/front-neck", "/design/back", "/design/tying", "/design/fit", "/design/add-ons"];
  for (const path of designSteps) {
    await clickPrimary(page);
    const escaped = path.replace(/[\/]/g, "\\/");
    await page.waitForURL(new RegExp(escaped + "$"), { timeout: 15000 });
    console.log("At:", page.url());
  }

  // ── Step 3: /review → Continue → /contact ──
  await clickPrimary(page);
  await page.waitForURL(/\/review/, { timeout: 10000 });
  console.log("At:", page.url());
  await clickPrimary(page);
  await page.waitForURL(/\/contact/, { timeout: 10000 });
  console.log("At:", page.url());
  await dumpAuth(page, "at /contact (anon)");

  // ── Step 4: Fill contact form and submit (anon) ──
  await page.locator('input[name="phone"]').fill("9876543210");
  await page.locator('input[name="name"]').fill("Test User");
  await page.locator('input[name="address1"]').fill("123 Test Street");
  await page.locator('input[name="pincode"]').fill("560001");
  await page.waitForTimeout(1000); // wait for map/pin

  await clickPrimary(page);
  await page.waitForURL(/\/otp/, { timeout: 10000 });
  console.log("At:", page.url());
  await dumpAuth(page, "at /otp");

  // ── Step 5: Enter OTP and verify ──
  const otpInput = page.locator('input[autocomplete="one-time-code"]');
  await otpInput.waitFor({ state: "visible", timeout: 10000 });
  await otpInput.fill("123456");
  await page.getByRole("button", { name: /^Verify & continue$/ }).click();
  await page.waitForURL((url) => !url.pathname.includes("/otp"), { timeout: 15000 });
  console.log("After OTP verify:", page.url());
  await dumpAuth(page, "after OTP verify");

  // ── Step 6: If at /contact, fill again and submit (auth) ──
  if (page.url().includes("/contact")) {
    console.log("\n=== Submitting authenticated contact ===");
    await page.waitForTimeout(1000);
    // Re-fill in case
    const phoneVal = await page.locator('input[name="phone"]').inputValue().catch(() => "");
    if (!phoneVal) await page.locator('input[name="phone"]').fill("9876543210");
    const nameVal = await page.locator('input[name="name"]').inputValue().catch(() => "");
    if (!nameVal) await page.locator('input[name="name"]').fill("Test User");
    const addrVal = await page.locator('input[name="address1"]').inputValue().catch(() => "");
    if (!addrVal) await page.locator('input[name="address1"]').fill("123 Test Street");
    const pinVal = await page.locator('input[name="pincode"]').inputValue().catch(() => "");
    if (!pinVal) await page.locator('input[name="pincode"]').fill("560001");

    const submitBtn = page.getByRole("button", { name: /Continue to payment|Verify & continue/i });
    const isDisabled = await submitBtn.isDisabled().catch(() => "n/a");
    console.log("Submit disabled?", isDisabled);

    // Wait for the button to be enabled (it may be disabled during area check)
    if (isDisabled === true) {
      console.log("Waiting for submit to enable...");
      await page.waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          const b = btns.find(x => /Continue to payment|Verify & continue/i.test(x.textContent));
          return b && !b.disabled;
        },
        { timeout: 10000 },
      ).catch(() => console.log("Still disabled after 10s"));
    }

    // Set up a response promise for the PUT
    const putResponsePromise = page.waitForResponse(
      (res) => res.url().includes("/contact") && res.request().method() === "PUT",
      { timeout: 15000 },
    ).catch(() => null);

    await submitBtn.click({ force: true });
    console.log("Clicked submit. Waiting for PUT response...");
    const putResponse = await putResponsePromise;
    if (putResponse) {
      const status = putResponse.status();
      const body = await putResponse.text().catch(() => "");
      console.log(`PUT /contact response: ${status}`);
      console.log(`PUT /contact body: ${body.slice(0, 300)}`);
    } else {
      console.log("No PUT response received within 15s");
    }

    await page.waitForTimeout(2000);
    console.log("After auth contact submit:", page.url());

    // Check for error banner
    const errBanner = await page.getByText(/Couldn't save/i).count();
    const errText = await page.evaluate(() => {
      const banners = document.querySelectorAll('[class*="error"], [class*="banner"], [role="alert"]');
      return Array.from(banners).map(b => b.textContent.trim()).filter(Boolean);
    });
    console.log("Error banner count:", errBanner);
    console.log("Banner texts:", JSON.stringify(errText));
  }

  console.log("\n=== DONE ===");
  console.log("Final URL:", page.url());
  await dumpAuth(page, "final");

} catch (err) {
  console.log("\nSCRIPT ERROR:", err.message);
  console.log("Current URL:", page.url());
  await dumpAuth(page, "on error");
} finally {
  await browser.close();
}
