/**
 * Walk-in v2 E2E (WALKIN_V2_PLAN.md §8.4) — drives the real local stack.
 *
 * Cases:
 *   A-1  Happy path — captain login → wizard → existing customer (7986147238)
 *        → OTP → saved address → order → garment (created at configurator
 *        Done, with selections) → review QR + Check now (one screen) → COD →
 *        Check now → Start measurement → dashboard Active shows the job.
 *   A-2  Customer QR landing — gate shows anonymously; session seeded via the
 *        legacy test-mode OTP API (MSG91 widget can't complete headless);
 *        COD applied via POST /orders/{id}/pay-method (Cashfree sandbox is a
 *        manual pass — the ledger effect on payment_ready is identical).
 *   A-3  Drop journey — new throwaway customer → wait step → Drop → cancelled.
 *   A-4  Resume — dashboard Walk-ins tab card → wizard resumes at review.
 *   A-5  Wrong user — another session opens the QR URL → owner-phone alert.
 *   A-7  Hard block — no auto-check (no polling), Start disabled until paid,
 *        Drop is the only escape.
 *
 * Run: cd fe && node walkin-v2.e2e.mjs   (FE :3002 + BE :8000 must be up)
 */

import { chromium } from "playwright";

const BASE = "http://localhost:3002";
const API = "http://localhost:8000/api/v1";
const CAPTAIN_PHONE = "9000000101"; // seeded via be/scripts/seed_users.py
const CAPTAIN_PASSWORD = "style_captain_1";
const CUSTOMER_PHONE = "9000000001"; // seeded customer (Aarav) with 1 saved address
// Unique per run — the user is created by A-3 and must not exist beforehand.
const THROWAWAY_PHONE = "9" + String(Date.now()).slice(-9);
const OTP = "1221"; // OTP_MODE=test test code

const consoleErrors = [];
const failedRequests = [];
let stepCount = 0;

function step(name) {
  stepCount += 1;
  console.log(`\n[${String(stepCount).padStart(2, "0")}] ${name}`);
}

function ok(msg) {
  console.log(`     ✓ ${msg}`);
}

async function screenshot(page, name) {
  const path = `/tmp/walkin-e2e-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`     📸 ${path}`);
}

function attachCollectors(page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[${page.url()}] ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
}

/**
 * Switch a dashboard tab (Active / Missed / Recent / Walk-ins). A click that
 * lands between DOM-ready and React hydration is silently dropped, so verify
 * the active pill styling (`bg-ink-navy`) landed and retry a couple of times.
 */
async function switchDashboardTab(page, name) {
  const btn = page.getByRole("button", { name });
  const activePill = page.locator("button.bg-ink-navy").filter({ hasText: name });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await btn.click();
    try {
      await activePill.first().waitFor({ timeout: 3_000 });
      return;
    } catch {
      // hydration swallowed the click — React is live now, click again
    }
  }
  throw new Error(`dashboard tab "${name}" never activated`);
}

/** Seed a customer app session the way the auth store persists it. */
async function mintUserSession(phone) {
  const res = await fetch(`${API}/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, country_code: "+91", otp: OTP }),
  });
  if (!res.ok) {
    throw new Error(`otp/verify failed for ${phone}: ${res.status} ${await res.text()}`);
  }
  return res.json(); // { session_token, session_type, user, expires_at, ... }
}

async function seedAppSession(page, session) {
  // localStorage is unreachable on about:blank — land on the origin first.
  if (!page.url().startsWith(BASE)) {
    // The app's bootstrap mints an anonymous session and PERSISTS it to
    // localStorage; wait for that to settle, or it overwrites our seeded
    // user session after the write.
    const anonDone = page.waitForResponse(
      (r) => r.url().includes("/auth/anonymous"),
      { timeout: 20_000 },
    );
    await page.goto(BASE);
    await anonDone.catch(() => {});
    await page.waitForFunction(
      () => window.localStorage.getItem("draep-auth") !== null,
      null,
      { timeout: 10_000 },
    ).catch(() => {});
    await page.waitForTimeout(300); // let any in-flight persist commit
  }
  await page.evaluate(
    ({ token, user, expiresAt }) => {
      window.localStorage.setItem(
        "draep-auth",
        JSON.stringify({
          state: { token, sessionType: "user", user, activeOrderId: null, expiresAt },
          version: 0,
        }),
      );
    },
    {
      token: session.session_token,
      user: session.user,
      expiresAt: new Date(session.expires_at).getTime(),
    },
  );
}

async function captainLogin(page) {
  await page.goto(`${BASE}/style_captain_dashboard/login`);
  await page.locator('input[type="tel"]').fill(CAPTAIN_PHONE);
  await page.locator('input[type="password"]').fill(CAPTAIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/style_captain_dashboard");
  ok("captain signed in, on dashboard");
}

/** Drive the wizard from step 1 through the review/QR screen (real routes:
 * /walk-in → /walk-in/otp → /walk-in/address → /walk-in/garments →
 * /walk-in/review?order=…). Returns order ids. */
async function runWizardToReview(page, { phone, existing }) {
  await page.goto(`${BASE}/style_captain_dashboard/walk-in`);

  // Route 1 — phone lookup (debounced; Send OTP enables once searched).
  // New users must also give a name in the lookup panel first.
  await page.locator('input[placeholder="10-digit mobile number"]').fill(phone);
  if (!existing) {
    await page.locator('input[placeholder="Full name"]').fill("E2E Throwaway");
  }
  await page.getByRole("button", { name: "Send OTP" }).click({ timeout: 15_000 });

  // Route 2 — OTP typed by the captain (user created on verify)
  await page.waitForURL("**/walk-in/otp", { timeout: 15_000 });
  await page.locator('input[autocomplete="one-time-code"]').fill(OTP);
  await page.getByRole("button", { name: "Verify code" }).click();

  // Step 2 — address
  if (existing) {
    const saved = page.locator('input[type="radio"][name="address"]');
    await saved.first().waitFor({ state: "visible", timeout: 10_000 });
    await saved.first().check();
  } else {
    await page.locator('input[placeholder="House no, building, street"]').fill("12 E2E Test Lane");
    await page.locator('input[placeholder="Bangalore"]').fill("Bengaluru");
    await page.locator('input[placeholder="Karnataka"]').fill("Karnataka");
    await page.locator('input[placeholder="560102"]').fill("560102");
  }

  // Route 3 — address (local only) → Route 4 garments
  await page.waitForURL("**/walk-in/address", { timeout: 15_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/walk-in/garments", { timeout: 15_000 });
  const firstGarment = page.locator("div.grid.grid-cols-2 > button").first();
  await firstGarment.waitFor({ state: "visible", timeout: 15_000 });
  await firstGarment.click();

  // Step 3b — the configurator lives in a bottom sheet now: tap the first
  // option card each step (tapping advances), then Done in the sheet footer.
  // Done is when the garment is actually created — capture that POST.
  // Done on the FIRST garment fires the order-with-garment POST — the order
  // is created (pending) together with the garment. Capture it for the ids.
  const garmentPost = page
    .waitForResponse(
      (r) =>
        r.url().includes("/style-captain/walk-in/orders/with-garment") &&
        r.request().method() === "POST" &&
        (r.status() === 200 || r.status() === 201),
      { timeout: 30_000 },
    )
    .then((r) => r.json());
  const stepCounter = page.getByTestId("wi-step-counter");
  for (let i = 0; i < 15; i++) {
    await stepCounter.waitFor({ timeout: 15_000 });
    const doneBtn = page.getByTestId("wi-config-done");
    if (await doneBtn.count()) {
      await doneBtn.click();
      break;
    }
    const before = (await stepCounter.textContent()) ?? "";
    // First option card inside the sheet (rounded-card buttons; the Back
    // pill is rounded-pill).
    await page
      .locator('div[role="dialog"] div.overflow-y-auto button.rounded-card')
      .first()
      .click();
    await stepCounter
      .filter({ hasText: new RegExp(`^(?!${before.trim()}$)`) })
      .waitFor({ timeout: 10_000 });
  }
  const created = await garmentPost;
  // First garment Done creates the order and navigates to /walk-in/review.
  await page.waitForURL((u) => u.pathname.endsWith("/walk-in/review"), { timeout: 15_000 });
  ok(`order ${created.order_number} (${created.order_id}) created pending with the first garment`);

  // Step 3c/4 — review + QR + payment, one screen
  await page
    .locator('img[alt="QR code to open the order payment page"]')
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Check now" }).waitFor({ timeout: 10_000 });
  ok("review shows QR + inline Check now");

  return { orderId: created.order_id, orderNumber: created.order_number };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── A-1 · captain leg ────────────────────────────────────────────────────
  step("A-1 captain login");
  const captainCtx = await browser.newContext();
  const captain = await captainCtx.newPage();
  attachCollectors(captain);
  // The wizard's OTP is REAL when the MSG91 widget env vars are set. Stub the
  // widget's methods before any app script runs: send succeeds, verify
  // returns the test code as the one-time token (test mode accepts it).
  await captain.addInitScript((code) => {
    window.sendOtp = (id, ok) => ok && ok({ type: "success" });
    window.verifyOtp = (otp, ok) =>
      ok && ok({ type: "success", message: otp.length === 4 ? code : "wrong" });
  }, OTP);
  // Dev runs the REAL widget + a real BE authkey, so the stubbed token above
  // would fail real MSG91 verification. Rewrite the verify call to the plain
  // test-code path (OTP_MODE=test accepts it server-side).
  await captain.route("**/style-captain/walk-in/otp/verify", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    delete body.otp_token;
    body.otp = OTP;
    await route.continue({ postData: JSON.stringify(body) });
  });
  await captainLogin(captain);

  step("A-1 wizard → review screen (existing customer)");
  const a1 = await runWizardToReview(captain, { phone: CUSTOMER_PHONE, existing: true });

  // ── A-7 · slot-first CTA: choose-slot phase (no slot yet) ───────────
  step("A-7 choose-slot phase — Measure Now | Schedule Later sticky CTA");
  await captain.getByRole("button", { name: "Measure Now" }).waitFor({ timeout: 15_000 });
  await captain.getByRole("button", { name: "Schedule Later" }).waitFor();
  if ((await captain.getByRole("button", { name: "Check for Payment" }).count()) > 0) {
    throw new Error("Check for Payment must not appear before a slot exists");
  }
  ok("sticky CTA offers Measure Now | Schedule Later");

  // ── A-4 + A-6 · Walk-ins tab → resume ───────────────────────────────
  step("A-6 dashboard Walk-ins tab lists the draft");
  await captain.goto(`${BASE}/style_captain_dashboard`);
  await switchDashboardTab(captain, "Walk-ins");
  const card = captain.locator("article").filter({ hasText: a1.orderNumber }).first();
  // The dev DB is remote (WAN) — dashboard loads take 5-15s. Wait generously.
  await card.waitFor({ timeout: 30_000 });
  await card.getByText("Awaiting customer", { exact: true }).waitFor();
  ok(`card for order ${a1.orderNumber} visible, chip "Awaiting customer"`);

  step("A-4 resume via card → front door redirects to review (slot CTA)");
  await card.getByText("Resume →").click();
  await captain.waitForURL(
    (u) => u.pathname.endsWith("/walk-in/review") && u.searchParams.get("order") === a1.orderId,
    { timeout: 20_000 },
  );
  await captain.getByRole("button", { name: "Measure Now" }).waitFor({ timeout: 15_000 });
  ok("resumed with garments → review route, slot-first CTA");

  // ── A-2 · customer QR landing ────────────────────────────────────────────
  step("A-2 anonymous QR landing shows the login gate");
  const payUrl = `${BASE}/app/orders/${a1.orderId}?wi=1&ph=${CUSTOMER_PHONE}`;
  const customerCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  attachCollectors(customer);
  await customer.goto(payUrl);
  await customer
    .getByRole("heading", { name: "Log in to see your order" })
    .waitFor({ timeout: 20_000 });
  await customer.locator('input[aria-label="Verification code"]').waitFor();
  ok("gate rendered with OTP input");

  step("A-2 seed customer session (test-mode API) → order visible in app");
  const session = await mintUserSession(CUSTOMER_PHONE);
  await seedAppSession(customer, session);
  await customer.goto(payUrl);
  await customer.getByText(a1.orderNumber).first().waitFor({ timeout: 20_000 });
  ok(`order ${a1.orderNumber} visible to its owner`);
  await screenshot(customer, "a2-customer-order");

  step("A-2 customer chooses COD (pay-method API)");
  const codRes = await customer.request.post(`${API}/orders/${a1.orderId}/pay-method`, {
    headers: { Authorization: `Bearer ${session.session_token}` },
    data: { method: "cod" },
  });
  if (!codRes.ok()) {
    throw new Error(`pay-method failed: ${codRes.status()} ${await codRes.text()}`);
  }
  ok("COD applied (Cashfree online payment is a manual sandbox pass)");

  // ── Schedule Later → draft slot → Check for Payment → confirmation ─────
  step("A-1 Schedule Later drafts a non-blocking slot (same as /app)");
  await captain.goto(
    `${BASE}/style_captain_dashboard/walk-in/review?order=${a1.orderId}`,
  );
  await captain.getByRole("button", { name: "Schedule Later" }).waitFor({ timeout: 15_000 });
  await captain.getByRole("button", { name: "Schedule Later" }).click();
  const slotPost = captain.waitForResponse(
    (r) =>
      r.url().includes("/style-captain/walk-in/orders/") &&
      r.url().endsWith("/slot") &&
      r.request().method() === "POST",
    { timeout: 20_000 },
  );
  // Same bottom sheet as /app: pick the first offered time, then Select.
  const sheet = captain.locator('div[role="dialog"]');
  await sheet.waitFor({ timeout: 15_000 });
  const timeBtn = sheet.locator("button", { hasText: /\d{1,2}:\d{2}\s?(AM|PM)/ }).first();
  await timeBtn.waitFor({ state: "visible", timeout: 10_000 });
  await timeBtn.click();
  await sheet.getByRole("button", { name: "Select" }).click();
  await slotPost;
  ok("slot drafted via the /app sheet");

  step("A-1 Check for Payment → order confirmation (visit for later)");
  await captain
    .getByRole("button", { name: "Check for Payment" })
    .waitFor({ timeout: 15_000 });
  await captain.getByRole("button", { name: "Check for Payment" }).click();
  await captain
    .getByText(/Order ${a1.orderNumber} confirmed/)
    .waitFor({ timeout: 20_000 });
  ok("confirmation view shows the booked visit");

  step("A-1 dashboard back");
  await captain.getByRole("button", { name: "Back to dashboard" }).click();
  await captain.waitForURL("**/style_captain_dashboard");
  await captain.waitForTimeout(500);
  ok("back on dashboard");

  // ── A-3 · drop journey (new throwaway customer) ─────────────────────────
  step("A-3 new customer walk-in → Measure Now → COD → Check → job opened");
  const a3 = await runWizardToReview(captain, { phone: THROWAWAY_PHONE, existing: false });
  await captain.getByRole("button", { name: "Measure Now" }).waitFor({ timeout: 15_000 });
  await captain.getByRole("button", { name: "Measure Now" }).click();
  await captain
    .getByRole("button", { name: "Check for Payment" })
    .waitFor({ timeout: 20_000 });
  ok("measured now — job exists, payment check gates opening it");
  // Customer pays COD for the throwaway order (owner session minted fresh).
  const a3Session = await mintUserSession(THROWAWAY_PHONE);
  const a3Cod = await captain.request.post(`${API}/orders/${a3.orderId}/pay-method`, {
    headers: { Authorization: `Bearer ${a3Session.session_token}` },
    data: { method: "cod" },
  });
  if (!a3Cod.ok()) {
    throw new Error(`pay-method failed: ${a3Cod.status()} ${await a3Cod.text()}`);
  }
  await captain.getByRole("button", { name: "Check for Payment" }).click();
  // Paid + measured-now → auto-navigates into the measurement wizard.
  await captain.waitForURL(/\/style_captain_dashboard\/measure\//, { timeout: 20_000 });
  ok("paid → auto-navigated into the measurement wizard");

  step("A-1 dashboard Active tab shows the measurement job");
  await captain.goto(`${BASE}/style_captain_dashboard`);
  await captain.getByText(a3.orderNumber).first().waitFor({ timeout: 30_000 });
  ok("job card for the walk-in order on Active");

  step("A-3 drop journey — a fresh unpaid walk-in can still be dropped");
  const a3b = await runWizardToReview(captain, { phone: "9" + String(Date.now()).slice(-9), existing: false });
  captain.once("dialog", (d) => d.accept());
  await captain.getByRole("button", { name: "Drop this walk-in" }).click();
  await captain
    .getByText("This walk-in was dropped. The draft order stays cancelled.")
    .waitFor({ timeout: 15_000 });
  ok(`walk-in ${a3b.orderNumber} dropped`);

  step("A-3 Walk-ins tab shows it as Cancelled");
  await captain.goto(`${BASE}/style_captain_dashboard`);
  await switchDashboardTab(captain, "Walk-ins");
  const cancelledCard = captain.locator("article").filter({ hasText: a3b.orderNumber }).first();
  await cancelledCard.waitFor({ timeout: 30_000 });
  await cancelledCard.getByText("Cancelled", { exact: true }).waitFor();
  await cancelledCard.getByText("View →").waitFor();
  ok("cancelled card with View (not Resume)");
  await screenshot(captain, "a3-cancelled-tab");

  // ── A-5 · wrong user opens the QR link ───────────────────────────────────
  step("A-5 different session → owner-phone alert");
  const wrongCtx = await browser.newContext();
  const wrong = await wrongCtx.newPage();
  attachCollectors(wrong);
  const wrongSession = await mintUserSession(THROWAWAY_PHONE); // exists since A-3
  await seedAppSession(wrong, wrongSession);
  await wrong.goto(payUrl);
  await wrong
    .getByRole("alert")
    .filter({ hasText: "This order belongs to a different phone number" })
    .waitFor({ timeout: 20_000 });
  await wrong.getByText(`•••••${CUSTOMER_PHONE.slice(-4)}`).waitFor();
  ok("wrong-user alert with masked owner phone");
  await wrongCtx.close();

  await browser.close();

  // ── Report ───────────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────");
  console.log(`✅ All walk-in v2 E2E cases passed (${stepCount} steps).`);
  if (consoleErrors.length) {
    console.log(`\n⚠️  console errors (${consoleErrors.length}):`);
    for (const e of consoleErrors.slice(0, 10)) console.log(`   ${e}`);
  }
  if (failedRequests.length) {
    console.log(`\n⚠️  failed requests (${failedRequests.length}):`);
    for (const f of failedRequests.slice(0, 10)) console.log(`   ${f}`);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
