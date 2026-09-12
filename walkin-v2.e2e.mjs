/**
 * Walk-in v2 E2E (WALKIN_V2_PLAN.md §8.4) — drives the real local stack.
 *
 * Cases:
 *   A-1  Happy path — captain login → wizard → existing customer (7986147238)
 *        → OTP → saved address → order → garment → review QR → wait → COD →
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

/** Drive the wizard from step 1 through the wait step. Returns order ids. */
async function runWizardToWait(page, { phone, existing }) {
  await page.goto(`${BASE}/style_captain_dashboard/walk-in`);

  // Step 1 — phone lookup (debounced; Send OTP enables once searched).
  // New users must also give a name in the lookup panel first.
  await page.locator('input[placeholder="10-digit mobile number"]').fill(phone);
  if (!existing) {
    await page.locator('input[placeholder="Full name"]').fill("E2E Throwaway");
  }
  await page.getByRole("button", { name: "Send OTP" }).click({ timeout: 15_000 });

  // Step 1.1 — OTP typed by the captain
  await page.locator('input[autocomplete="one-time-code"]').fill(OTP);
  await page.getByRole("button", { name: "Verify code" }).click();

  // New customers hit the wizard's own name confirm step next.
  if (!existing) {
    await page.getByRole("button", { name: "Continue" }).waitFor({ timeout: 10_000 });
    await page.locator('input[placeholder="Full name"]').fill("E2E Throwaway");
    await page.getByRole("button", { name: "Continue" }).click();
  }

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

  // Step 3 entry — capture order_id off the create POST response
  const createDone = page
    .waitForResponse(
      (r) =>
        r.url().includes("/style-captain/walk-in/orders") &&
        r.request().method() === "POST" &&
        (r.status() === 200 || r.status() === 201),
      { timeout: 20_000 },
    )
    .then((r) => r.json());
  await page.getByRole("button", { name: "Create walk-in order" }).click();
  const created = await createDone;
  await page.getByRole("button", { name: "Add garments" }).waitFor({ timeout: 10_000 });
  ok(`order ${created.order_number} (${created.order_id}) created`);

  // Step 3a — add first catalogue garment, keep server defaults (Cancel)
  await page.getByRole("button", { name: "Add garments" }).click();
  const firstGarment = page.locator("div.grid.grid-cols-2 > button").first();
  await firstGarment.waitFor({ state: "visible", timeout: 15_000 });
  await firstGarment.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  ok("garment added, SelectionSheet cancelled — server defaults kept");

  // Step 3c — review + QR (closing the sheet auto-advances to review)
  await page
    .locator('img[alt="QR code to open the order payment page"]')
    .waitFor({ timeout: 15_000 });
  ok("review shows house-styled QR");

  // Step 4 — wait
  await page.getByRole("button", { name: "Continue — wait for payment" }).click();
  await page.getByRole("button", { name: "Check now" }).waitFor({ timeout: 10_000 });
  ok("wait step reached");

  return { orderId: created.order_id, orderNumber: created.order_number };
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── A-1 · captain leg ────────────────────────────────────────────────────
  step("A-1 captain login");
  const captainCtx = await browser.newContext();
  const captain = await captainCtx.newPage();
  attachCollectors(captain);
  await captainLogin(captain);

  step("A-1 wizard → wait step (existing customer)");
  const a1 = await runWizardToWait(captain, { phone: CUSTOMER_PHONE, existing: true });

  // ── A-7 · hard block, no polling ─────────────────────────────────────────
  step("A-7 hard block — Start disabled, Drop only escape, no auto-check");
  const startBtn = captain.getByRole("button", { name: "Start measurement" });
  if (!(await startBtn.isDisabled())) {
    throw new Error("Start measurement should be disabled while unpaid");
  }
  ok("Start measurement disabled while unpaid");
  await captain.getByRole("button", { name: "Drop this walk-in" }).waitFor();
  ok("Drop this walk-in present (the only escape)");
  const payish = await captain
    .locator("button")
    .filter({
      hasText: /^(?!.*(?:Check now|Start measurement|Drop this walk-in)).*(?:pay|skip|continue|proceed)/i,
    })
    .count();
  if (payish > 0) throw new Error(`unexpected escape controls on wait step: ${payish}`);
  ok("no pay/skip/continue escape controls");
  await captain.waitForTimeout(3_500); // longer than any plausible poll tick
  if ((await captain.getByText(/^Last checked/).count()) > 0) {
    throw new Error("wait step auto-checked — polling is not allowed");
  }
  ok("no auto status check (no polling)");

  step("A-7 Check now (unpaid) — stays blocked, stamps Last checked");
  await captain.getByRole("button", { name: "Check now" }).click();
  await captain.getByText(/^Last checked/).waitFor({ timeout: 10_000 });
  if (!(await startBtn.isDisabled())) throw new Error("Start measurement enabled before payment");
  ok("still unpaid; Last checked stamped");

  // ── A-4 + A-6 · Walk-ins tab → resume ───────────────────────────────────
  step("A-6 dashboard Walk-ins tab lists the draft");
  await captain.goto(`${BASE}/style_captain_dashboard`);
  await switchDashboardTab(captain, "Walk-ins");
  const card = captain.locator("article").filter({ hasText: a1.orderNumber }).first();
  // The dev DB is remote (WAN) — dashboard loads take 5-15s. Wait generously.
  await card.waitFor({ timeout: 30_000 });
  await card.getByText("Awaiting customer", { exact: true }).waitFor();
  ok(`card for order ${a1.orderNumber} visible, chip "Awaiting customer"`);

  step("A-4 resume via card → wizard back at review");
  await card.getByText("Resume →").click();
  await captain.waitForURL((u) => u.searchParams.get("order") === a1.orderId, { timeout: 15_000 });
  await captain
    .getByRole("button", { name: "Continue — wait for payment" })
    .waitFor({ timeout: 15_000 });
  ok("resumed with garments → review step");
  await captain.getByRole("button", { name: "Continue — wait for payment" }).click();
  await captain.getByRole("button", { name: "Check now" }).waitFor({ timeout: 10_000 });
  ok("back on wait step");

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

  // ── A-1 · captain closes the loop ────────────────────────────────────────
  step("A-1 captain Check now → payment confirmed → Start measurement");
  await captain.getByRole("button", { name: "Check now" }).click();
  await captain
    .getByText("✓ Payment confirmed (Cash on delivery)")
    .waitFor({ timeout: 10_000 });
  ok("paid banner shows COD");
  await startBtn.click();
  await captain.getByText("✓ Measurement started.").waitFor({ timeout: 20_000 });
  ok("measurement started");

  step("A-1 dashboard Active tab shows the measurement job");
  await captain.getByRole("button", { name: "Back to dashboard" }).click();
  await captain.waitForURL("**/style_captain_dashboard");
  await captain.getByText(a1.orderNumber).first().waitFor({ timeout: 30_000 });
  ok("job card for the walk-in order on Active");

  step("A-1 Walk-ins tab no longer lists the converted order");
  const listRefetch = captain.waitForResponse(
    (r) => r.url().includes("/style-captain/walk-in/orders"),
    { timeout: 30_000 },
  );
  await switchDashboardTab(captain, "Walk-ins"); // fires refreshWalkIns
  await listRefetch;
  await captain.waitForTimeout(500); // refetched list commits
  if ((await captain.getByText(a1.orderNumber).count()) > 0) {
    throw new Error("converted walk-in still listed in Walk-ins tab");
  }
  ok("gone from Walk-ins (job exists now)");

  // ── A-3 · drop journey (new throwaway customer) ─────────────────────────
  step("A-3 new customer walk-in → wait → Drop → cancelled");
  const a3 = await runWizardToWait(captain, { phone: THROWAWAY_PHONE, existing: false });
  captain.once("dialog", (d) => d.accept());
  await captain.getByRole("button", { name: "Drop this walk-in" }).click();
  await captain
    .getByText("This walk-in was dropped. The draft order stays cancelled.")
    .waitFor({ timeout: 15_000 });
  ok(`walk-in ${a3.orderNumber} dropped`);

  step("A-3 Walk-ins tab shows it as Cancelled");
  await captain.goto(`${BASE}/style_captain_dashboard`);
  await switchDashboardTab(captain, "Walk-ins");
  const cancelledCard = captain.locator("article").filter({ hasText: a3.orderNumber }).first();
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
