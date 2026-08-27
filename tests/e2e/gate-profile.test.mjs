/**
 * App-wide blocking profile completion — E2E test cases (test OTP mode).
 *
 * Covers the ProfileCompletionGate mounted in the /app layout: a signed-in
 * user missing name and/or gender is blocked on EVERY /app surface by a
 * fullscreen overlay that asks only the missing field(s); a fresh OTP
 * signup hits it the moment verify succeeds (the login sheet hands off and
 * the overlay takes the ask).
 *
 * Prerequisites (test OTP mode — no real SMS):
 *   1. BE on :8000 with OTP_MODE=test (OTP_TEST_CODE=123456).
 *   2. FE dev server booted with the MSG91 widget vars BLANK so the sheet
 *      uses the legacy test endpoints, e.g. from the fe dir:
 *
 *        NEXT_PUBLIC_MSG91_WIDGET_ID= NEXT_PUBLIC_MSG91_TOKEN_AUTH= \
 *          npx next dev -p 3005
 *
 *   3. Run from the fe dir (playwright resolves from node_modules):
 *
 *        E2E_BASE=http://localhost:3005 node tests/e2e/gate-profile.test.mjs
 *
 * Fixed selectors: gate inputs #gate-phone / #gate-otp, overlay input
 * #profile-gate-name, overlay dialog name "One last stitch", gender chips
 * Male/Female/Other, profile submit "Continue", preview sheet title
 * "Review your selection" (its editor footer's Cancel is the ready signal;
 * the confirm CTA reads "Order now" — preview stacks on the detail sheet
 * → .last()).
 *
 * The run creates real orders on the BE — the script deletes them via the
 * API at the end. The two throwaway signups (phones below) stay in the DB;
 * they are clearly-marked test rows (names "Gate TC A/B") you can drop when
 * convenient.
 */

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3002";
const API = process.env.E2E_API ?? "http://localhost:8000/api/v1";
const PHONE_A = "9876543215"; // fresh signup through the gate
const PHONE_B = "9876543216"; // logged-in user missing gender
const TEST_OTP = "123456";
const ORDER_URL = /\/app\/orders\/[0-9a-f-]{36}/;

const PASS = [];
const FAIL = [];

function log(testId, description, passed, detail = "") {
  const line = `[${passed ? "PASS" : "FAIL"}] ${testId} — ${description}${detail ? " | " + detail : ""}`;
  console.log(line);
  if (passed) PASS.push(testId);
  else FAIL.push({ testId, description, detail });
}

/** Mint a session for `phone` straight through the test-mode OTP endpoints. */
async function mintSession(phone) {
  await fetch(`${API}/auth/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, country_code: "+91" }),
  });
  const res = await fetch(`${API}/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, country_code: "+91", otp: TEST_OTP, order_id: null }),
  });
  return res.json();
}

/** The blocking overlay (aria-label = its title). */
function overlay(page) {
  return page.getByRole("dialog", { name: "One last stitch" });
}

/** Library card → detail sheet → "Order now" (the gated CTA). */
async function tapOrderNow(page) {
  const card = page.getByRole("button", { name: /CLASSIC|CELEBRITY WORN/i }).first();
  await card.waitFor({ state: "visible", timeout: 15000 });
  await card.click();
  const orderNow = page.getByRole("button", { name: "Order now" });
  await orderNow.waitFor({ state: "visible", timeout: 10000 });
  await orderNow.click();
}

/**
 * Wait for the order-preview sheet (stacked on the detail sheet), confirm it
 * and return the order id from the landed URL. The editor footer's Cancel
 * button is the ready signal — clicking apply before it mounts resolves to
 * the detail sheet's "Order now" underneath.
 */
async function confirmPreviewAndAwaitOrder(page) {
  await page.getByText("Review your selection").first().waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "Order now" }).last().click();
  await page.waitForURL(ORDER_URL, { timeout: 20000 });
  return page.url().match(/orders\/([0-9a-f-]{36})/)?.[1] ?? null;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const created = []; // { token, orderId } — deleted in cleanup

  // ── Scenario A: fresh signup hits the overlay right after verify ───────
  console.log("\n--- Scenario A: fresh signup ---");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("  pageerror:", e.message));
    try {
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const card = page.getByRole("button", { name: /CLASSIC|CELEBRITY WORN/i }).first();
      await card.waitFor({ state: "visible", timeout: 15000 });
      log("TC-G.01", "Library loads with design cards", true);

      await card.click();
      await page.getByRole("button", { name: "Order now" }).click();
      const phone = page.locator("#gate-phone");
      await phone.waitFor({ state: "visible", timeout: 10000 });
      log("TC-G.02", "Order now opens the login gate on the phone step", true);

      await phone.fill(PHONE_A); // 10 digits auto-send the OTP
      const otp = page.locator("#gate-otp");
      await otp.waitFor({ state: "visible", timeout: 10000 });
      log("TC-G.03", "OTP step appears after phone entry", true);

      await otp.fill("999999");
      await page.getByRole("button", { name: "Verify" }).click();
      await page.waitForTimeout(1500);
      log(
        "TC-G.04",
        "Wrong OTP keeps the sheet on the OTP step (still anonymous — no overlay)",
        (await otp.isVisible()) && !(await overlay(page).count()),
      );

      await otp.fill(TEST_OTP);
      await page.getByRole("button", { name: "Verify" }).click();
      // The sheet hands off at verify and the app-wide overlay takes the ask.
      const nameField = page.locator("#profile-gate-name");
      await nameField.waitFor({ state: "visible", timeout: 10000 });
      log(
        "TC-G.05",
        "Verify → blocking overlay asks name + gender (no navigation)",
        !ORDER_URL.test(page.url()),
        page.url(),
      );

      const chips = await Promise.all(
        ["Male", "Female", "Other"].map((label) =>
          page.getByRole("button", { name: label, exact: true }).isVisible().catch(() => false),
        ),
      );
      log("TC-G.06", "Gender chips Male/Female/Other render", chips.every(Boolean));

      const continueBtn = page.getByRole("button", { name: "Continue" });
      const disabledEmpty = await continueBtn.isDisabled();
      await nameField.fill("Gate TC A");
      const disabledNameOnly = await continueBtn.isDisabled();
      await page.getByRole("button", { name: "Female", exact: true }).click();
      const enabledAfterGender = !(await continueBtn.isDisabled());
      log(
        "TC-G.07",
        "Continue stays disabled until BOTH name and gender are set",
        disabledEmpty && disabledNameOnly && enabledAfterGender,
      );

      await continueBtn.click();
      await overlay(page).waitFor({ state: "detached", timeout: 10000 });
      const orderId = await confirmPreviewAndAwaitOrder(page);
      log("TC-G.08", "Profile save lifts the block → order created", !!orderId, page.url());
      if (orderId) {
        const token = await page.evaluate(() => {
          const raw = localStorage.getItem("draep-auth");
          return raw ? JSON.parse(raw).state?.token ?? null : null;
        });
        if (token) created.push({ token, orderId });
      }
    } catch (err) {
      log("TC-G.09", "Scenario A completed without error", false, err.message);
      await page.screenshot({ path: "/tmp/gate-tc-fail-a.png" });
    } finally {
      await context.close();
    }
  }

  // ── Scenario B: logged-in user missing gender blocked by the overlay ───
  console.log("\n--- Scenario B: logged-in, gender missing ---");
  {
    const session = await mintSession(PHONE_B);
    log("TC-G.10", "Genderless session minted via test OTP API", !!session.session_token);
    // Name but NO gender — exactly the incomplete-profile state.
    const patch = await fetch(`${API}/auth/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({ name: "Gate TC B" }),
    });
    log("TC-G.11", "Name set with gender left null", patch.status === 200);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((s) => {
      localStorage.setItem(
        "draep-auth",
        JSON.stringify({
          state: {
            token: s.session_token,
            sessionType: "user",
            user: s.user,
            activeOrderId: null,
            expiresAt: Date.now() + 86_400_000,
          },
          version: 0,
        }),
      );
    }, session);
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
      const gate = overlay(page);
      await gate.waitFor({ state: "visible", timeout: 10000 });
      log("TC-G.12", "Overlay blocks /app on load — no phone step", !(await page.locator("#gate-phone").count()));
      log(
        "TC-G.13",
        "Only the missing field asked (no name input, gender group present)",
        (await page.locator("#profile-gate-name").count()) === 0 &&
          (await page.getByRole("group", { name: "Gender" }).count()) === 1,
      );

      await page.getByRole("button", { name: "Other", exact: true }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await gate.waitFor({ state: "detached", timeout: 10000 });

      await tapOrderNow(page);
      const orderId = await confirmPreviewAndAwaitOrder(page);
      log("TC-G.14", "Block lifted → CTA flows with no gate sheet → order created", !!orderId, page.url());
      if (orderId) created.push({ token: session.session_token, orderId });
    } catch (err) {
      log("TC-G.15", "Scenario B completed without error", false, err.message);
      await page.screenshot({ path: "/tmp/gate-tc-fail-b.png" });
    } finally {
      await context.close();
    }
  }

  // ── Cleanup: delete every order this run created ────────────────────────
  console.log("\n--- Cleanup ---");
  for (const { token, orderId } of created) {
    const res = await fetch(`${API}/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    log("TC-G.CLEAN", `Deleted test order ${orderId.slice(0, 8)}…`, res.status === 204, `HTTP ${res.status}`);
  }

  await browser.close();

  console.log("\n" + "=".repeat(70));
  console.log(`RESULTS: ${PASS.length} PASS, ${FAIL.length} FAIL out of ${PASS.length + FAIL.length} total`);
  console.log("=".repeat(70));

  if (FAIL.length > 0) {
    console.log("\nFAILURES:");
    for (const f of FAIL) {
      console.log(`  X ${f.testId} — ${f.description}${f.detail ? " | " + f.detail : ""}`);
    }
  }

  process.exit(FAIL.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
