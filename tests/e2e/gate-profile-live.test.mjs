/**
 * App-wide blocking profile completion — LIVE end-to-end matrix on the real
 * app. The ProfileCompletionGate (mounted in the /app layout) covers every
 * /app surface while a signed-in user is missing their name or gender, and
 * asks ONLY the missing field(s).
 *
 * Four profile states × gate behaviour (run as separate stages, because the
 * account's DB row must be flipped between them by the orchestrator):
 *
 *   --stage=live        Anonymous → gate sheet → REAL MSG91 OTP (env
 *                       LIVE_PHONE / LIVE_OTP) → verify → the sheet hands off
 *                       and the blocking overlay takes the profile ask (both
 *                       fields; account nulled first) → fill → preview →
 *                       order page → the full booking funnel: Select Address
 *                       → Select Slot → Confirm Booking → Cash on Delivery →
 *                       "Booking confirmed". Deletes the order afterwards.
 *   --stage=name-only   Logged-in user with name but NO gender → overlay
 *                       blocks /app on load, asks ONLY gender.
 *   --stage=gender-only Logged-in user with gender but NO name → overlay
 *                       blocks /app on load, asks ONLY name.
 *   --stage=complete    Logged-in user with both fields → NO overlay; the
 *                       CTA goes straight to the order-preview sheet.
 *
 * The injected stages mint their session through the BE's test-mode OTP
 * endpoints (OTP_MODE=test → code 123456) — no SMS — then set localStorage
 * before the app boots, exactly like a returning visitor.
 *
 * DB states the orchestrator sets on the test user before each stage
 * (psycopg2, users table):
 *   live        → name = NULL, gender = NULL
 *   name-only   → name = '<random>', gender = NULL
 *   gender-only → name = NULL, gender = '<random>'
 *   complete    → name + gender both set (use the account's real values —
 *                 the complete stage mutates nothing, so this doubles as
 *                 the restore step)
 *
 * Run from the fe dir against the live dev server, e.g.:
 *
 *   LIVE_PHONE=7986147238 LIVE_OTP=1221 \
 *     node tests/e2e/gate-profile-live.test.mjs --stage=live
 *
 * The live stage creates one real order (with a COD booking) and deletes it
 * via the API when done. Wrong-OTP is deliberately NOT tested here — a bad
 * attempt against the live widget can burn the real code.
 */

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3002";
const API = process.env.E2E_API ?? "http://localhost:8000/api/v1";
const PHONE = process.env.LIVE_PHONE ?? "";
const OTP = process.env.LIVE_OTP ?? "";
const STAGE = (process.argv.find((a) => a.startsWith("--stage=")) ?? "").slice(8) || "live";
const ORDER_URL = /\/app\/orders\/[0-9a-f-]{36}/;

const PASS = [];
const FAIL = [];

function log(id, description, passed, detail = "") {
  const line = `[${passed ? "PASS" : "FAIL"}] ${id} — ${description}${detail ? " | " + detail : ""}`;
  console.log(line);
  if (passed) PASS.push(id);
  else FAIL.push({ id, description, detail });
}

/** Session for the (already-manipulated) account via test-mode OTP. */
async function mintSession() {
  await fetch(`${API}/auth/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, country_code: "+91" }),
  });
  const res = await fetch(`${API}/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, country_code: "+91", otp: "123456", order_id: null }),
  });
  return res.json();
}

async function openContext(browser, session = null) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (session) {
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
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  return { context, page };
}

/** The blocking overlay (aria-label = its title). */
function overlay(page) {
  return page.getByRole("dialog", { name: "One last stitch" });
}

/** Library card → detail sheet → "Order now" (the gated CTA). */
async function tapOrderNow(page) {
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  const card = page.getByRole("button", { name: /CLASSIC|CELEBRITY WORN/i }).first();
  await card.waitFor({ state: "visible", timeout: 20000 });
  await card.click();
  await page.getByRole("button", { name: "Order now" }).click();
}

/** Wait for the order-preview sheet (stacked on the detail sheet). The title
 *  shows in both its loader state and the selection editor; the editor's
 *  footer (Cancel + apply) is the ready signal — clicking apply before it
 *  mounts resolves to the detail sheet's "Order now" underneath. */
async function waitForPreview(page) {
  await page
    .getByText("Review your selection")
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .waitFor({ state: "visible", timeout: 15000 });
}

/* ── Stage: live OTP → blocking overlay → full booking funnel ───────────── */
async function liveStage(browser) {
  if (!PHONE || !OTP) {
    log("TC-1.00", "LIVE_PHONE / LIVE_OTP env provided", false);
    return;
  }
  const { context, page } = await openContext(browser);
  let token = null;
  let orderId = null;
  try {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("button", { name: /CLASSIC|CELEBRITY WORN/i }).first();
    await card.waitFor({ state: "visible", timeout: 20000 });
    log("TC-1.01", "Library loads with design cards", true);

    await card.click();
    await page.getByRole("button", { name: "Order now" }).click();
    const phoneField = page.locator("#gate-phone");
    await phoneField.waitFor({ state: "visible", timeout: 10000 });
    log("TC-1.02", "Order now opens the login gate (phone step)", true);

    await phoneField.fill(PHONE); // 10 digits auto-send the live OTP
    const otpField = page.locator("#gate-otp");
    await otpField.waitFor({ state: "visible", timeout: 20000 });
    log("TC-1.03", "Live OTP dispatched — code entry appears", true);

    await otpField.fill(OTP);
    await page.getByRole("button", { name: "Verify" }).click();
    // Fresh signup: the sheet's job ends at verify (its host's next step
    // opens underneath) and the app-wide overlay takes over the profile ask.
    const overlayName = page.locator("#profile-gate-name");
    await overlayName.waitFor({ state: "visible", timeout: 20000 });
    log(
      "TC-1.04",
      "Verify → app-wide blocking overlay asks name + gender (no navigation)",
      !ORDER_URL.test(page.url()),
      page.url(),
    );

    await overlayName.fill("Vishant"); // restore the real profile through the UI
    await page.getByRole("button", { name: "Male", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await overlay(page).waitFor({ state: "detached", timeout: 10000 });
    await waitForPreview(page);
    log("TC-1.05", "Profile save lifts the block → preview sheet", true);

    await page.getByRole("button", { name: "Order now" }).last().click();
    await page.waitForURL(ORDER_URL, { timeout: 20000 });
    orderId = page.url().match(/orders\/([0-9a-f-]{36})/)?.[1] ?? null;
    log("TC-1.06", "Order created — landed on the order page", !!orderId, page.url());
    // Capture early so the failure path can still clean the order up.
    token = await page.evaluate(() => {
      const raw = localStorage.getItem("draep-auth");
      return raw ? JSON.parse(raw).state?.token ?? null : null;
    });

    /* ── Booking funnel: address → slot → COD ─────────────────────────── */
    // Saved addresses arrive via GET /addresses after the detail loads, and
    // the CTA routes to the add-address PAGE (not the picker) while the list
    // is still empty — so wait for the fetch to land before tapping it.
    await page.waitForResponse(
      (r) => r.url().includes("/addresses") && r.request().method() === "GET" && r.status() === 200,
      { timeout: 10000 },
    );
    await page.getByRole("button", { name: "Select Address" }).click();
    const addressRow = page.getByRole("button", { name: /Bengaluru/ }).first();
    await addressRow.waitFor({ state: "visible", timeout: 10000 });
    await addressRow.click();
    await page.getByRole("button", { name: "Select Slot" }).waitFor({ state: "visible", timeout: 15000 });
    log("TC-1.07", "Saved address attached — CTA advanced to Select Slot", true);

    await page.getByRole("button", { name: "Select Slot" }).click();
    await page.getByText("Pick a visit slot").waitFor({ state: "visible", timeout: 10000 });
    // The sheet auto-selects the first day with slots (today may be sold
    // out), so bookable capacity shows up as time chips straight away.
    const time = page.getByRole("button", { name: /\d{1,2}:\d{2}\s?(AM|PM)/i }).first();
    await time.waitFor({ state: "visible", timeout: 15000 });
    log("TC-1.08", "Slot sheet offers a bookable day", true);
    await time.click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Confirm Booking" }).waitFor({ state: "visible", timeout: 20000 });
    log("TC-1.09", "Visit slot drafted — CTA advanced to Confirm Booking", true);

    await page.getByRole("button", { name: "Confirm Booking" }).click();
    await page.getByText("How would you like to pay?").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: /Cash on Delivery/ }).click();
    const codConfirm = page.getByRole("button", { name: "Continue with Cash on Delivery" });
    await codConfirm.waitFor({ state: "visible", timeout: 10000 });
    await codConfirm.click();
    await page.getByText("Booking confirmed").first().waitFor({ state: "visible", timeout: 25000 });
    log("TC-1.10", "COD booking confirmed end-to-end", true);

    if (orderId && token) {
      const res = await fetch(`${API}/orders/${orderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      log("TC-1.11", `Test order deleted (${orderId.slice(0, 8)}…)`, res.status === 204, `HTTP ${res.status}`);
    } else {
      log("TC-1.11", "Test order deleted", false, "missing token or orderId");
    }
  } catch (err) {
    log("TC-1.99", "Live journey completed without error", false, err.message);
    await page.screenshot({ path: "/tmp/gate-live-fail.png" });
    // A failure past order creation must not leave the order behind.
    if (orderId && token) {
      await fetch(`${API}/orders/${orderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  } finally {
    await context.close();
  }
}

/* ── Injected stages: overlay blocks on load, asks only the missing field ── */
async function blockedStage(browser, id, missing /* "gender" | "name" */) {
  const session = await mintSession();
  log(`${id}.01`, "Session minted for the manipulated account", !!session.session_token);
  if (!session.session_token) return;

  const { context, page } = await openContext(browser, session);
  try {
    await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
    const gate = overlay(page);
    await gate.waitFor({ state: "visible", timeout: 10000 });
    log(`${id}.02`, "Blocking overlay appears on /app load (before any CTA)", true);

    // The overlay is opaque and on top — the library card underneath can't
    // receive the click, which is the "can't use the app" guarantee itself.
    const card = page.getByRole("button", { name: /CLASSIC|CELEBRITY WORN/i }).first();
    await card.waitFor({ state: "visible", timeout: 20000 });
    let intercepted = false;
    try {
      await card.click({ timeout: 1500 });
    } catch {
      intercepted = true;
    }
    log(`${id}.03`, "Content underneath unreachable (card click intercepted)", intercepted);

    const nameField = page.locator("#profile-gate-name");
    const genderGroup = page.getByRole("group", { name: "Gender" });
    const continueBtn = page.getByRole("button", { name: "Continue" });
    if (missing === "gender") {
      log(
        `${id}.04`,
        "Name already known — only gender asked",
        (await nameField.count()) === 0 && (await genderGroup.count()) === 1,
      );
      log(`${id}.05`, "Continue disabled until a chip is picked", await continueBtn.isDisabled());
      await page.getByRole("button", { name: "Female", exact: true }).click();
    } else {
      log(
        `${id}.04`,
        "Gender already known — only name asked",
        (await genderGroup.count()) === 0 && (await nameField.count()) === 1,
      );
      log(`${id}.05`, "Continue disabled until a name is typed", await continueBtn.isDisabled());
      await nameField.fill(`Random ${Math.floor(Math.random() * 1000)}`);
    }
    await continueBtn.click();
    await gate.waitFor({ state: "detached", timeout: 10000 });
    log(`${id}.06`, "Saving the missing field lifts the block (no navigation)", !ORDER_URL.test(page.url()), page.url());

    // Profile complete → the gated CTA flows with no gate sheet at all.
    await card.click();
    await page.getByRole("button", { name: "Order now" }).click();
    await waitForPreview(page);
    log(`${id}.07`, "CTA now goes straight to the preview (no login gate)", !(await page.locator("#gate-phone").count()));

    await page.keyboard.press("Escape"); // close preview without creating an order
    await page.waitForTimeout(500);
    log(`${id}.08`, "Preview closed without creating an order", !ORDER_URL.test(page.url()), page.url());
  } catch (err) {
    log(`${id}.99`, "Stage completed without error", false, err.message);
    await page.screenshot({ path: `/tmp/gate-${id}-fail.png` });
  } finally {
    await context.close();
  }
}

async function completeStage(browser) {
  const session = await mintSession();
  log("TC-4.01", "Session minted for the complete account", !!session.session_token);
  if (!session.session_token) return;

  const { context, page } = await openContext(browser, session);
  try {
    await tapOrderNow(page);
    await waitForPreview(page);
    const noOverlay = (await overlay(page).count()) === 0;
    log("TC-4.02", "Complete profile → NO overlay; CTA goes straight to preview", noOverlay);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    log("TC-4.03", "Preview closed without creating an order", !ORDER_URL.test(page.url()), page.url());
  } catch (err) {
    log("TC-4.99", "Stage completed without error", false, err.message);
    await page.screenshot({ path: "/tmp/gate-TC-4-fail.png" });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  console.log(`\n--- Stage: ${STAGE} (base ${BASE}) ---`);

  if (STAGE === "live") await liveStage(browser);
  else if (STAGE === "name-only") await blockedStage(browser, "TC-2", "gender");
  else if (STAGE === "gender-only") await blockedStage(browser, "TC-3", "name");
  else if (STAGE === "complete") await completeStage(browser);
  else log("TC-0.00", `Unknown stage "${STAGE}"`, false);

  await browser.close();

  console.log("\n" + "=".repeat(70));
  console.log(`RESULTS: ${PASS.length} PASS, ${FAIL.length} FAIL out of ${PASS.length + FAIL.length} total`);
  console.log("=".repeat(70));
  if (FAIL.length > 0) {
    console.log("\nFAILURES:");
    for (const f of FAIL) console.log(`  X ${f.id} — ${f.description}${f.detail ? " | " + f.detail : ""}`);
  }
  process.exit(FAIL.length > 0 ? 1 : 0);
})();
