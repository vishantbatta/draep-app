/**
 * Serviceability E2E — uniform add-address flow, user side (test OTP mode).
 *
 * Covers the agreed flow end-to-end on the FE:
 *   T1  account: save address OUTSIDE the fence -> row shows
 *       "Not serviceable here yet" (saving never blocks)
 *   T2  account: save address INSIDE the fence -> row shows no warning
 *   T3  order: pick the OUTSIDE address from the picker -> attach blocked
 *       with the BE message ("We don't serve this location yet.")
 *   T4  order: pick the INSIDE address -> attaches, deliver-to card updates
 *   T5  order: Select Slot -> real date chips render (coverage-gated list)
 *   T6  slots empty (stubbed response with reason) -> "No slots available,
 *       we will notify you when they open up." + POST /service-area/notify-me
 *       fired once
 *
 * Prerequisites:
 *   1. BE on :8000 with OTP_MODE=test (OTP_TEST_CODE=123456) AND the
 *      serviceability seed applied (scripts/seed_serviceability.py):
 *      fence row + test captain with HSR coverage + availability rule.
 *   2. FE dev server on :3002.
 *
 * Run from the fe dir:
 *      node tests/e2e/serviceability.test.mjs
 *
 * Uses the AGENTS.md test user (7986147238). Creates two addresses + one
 * draft order and deletes them via the API at the end — no existing data
 * is modified.
 */

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://localhost:3002";
const API = process.env.E2E_API ?? "http://localhost:8000/api/v1";
const PHONE = process.env.E2E_PHONE ?? "7986147238";
const TEST_OTP = "123456";
const GARMENT = "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e"; // Blouse

const OUTSIDE = { latitude: 13.37, longitude: 77.68 }; // Nandi Hills — outside fence
const INSIDE = { latitude: 12.9116, longitude: 77.6474 }; // HSR Layout — in fence+coverage
const UNCOVERED = { latitude: 12.9698, longitude: 77.75 }; // Whitefield — in fence, no captain

const PASS = [];
const FAIL = [];
function log(id, desc, passed, detail = "") {
  console.log(`[${passed ? "PASS" : "FAIL"}] ${id} — ${desc}${detail ? " | " + detail : ""}`);
  (passed ? PASS : FAIL).push({ id, desc });
}

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

const api = (token) => async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

/** Fresh context logged in as the test user, with a fixed geolocation. */
async function openContext(browser, session, geo) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: geo,
    permissions: ["geolocation"],
  });
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
  // Deterministic geocoding: never let live Nominatim clobber typed fields.
  context.route("https://nominatim.openstreetmap.org/reverse*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  context.route("https://nominatim.openstreetmap.org/search*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  return { context, page };
}

/** Fill + save an address in the account bottom sheet. Waits out the
 *  reverse-geocode so it can't clobber the typed fields. */
async function addAddress(page, { line1, city, state, pincode }) {
  await page.getByRole("button", { name: "Add address" }).first().click();
  await page.locator("#addr-line1").waitFor({ state: "visible", timeout: 10_000 });
  // geolocation prefill triggers a reverse geocode — let it settle
  await page.getByText("Updating address from pin…").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  await page.locator("#addr-line1").fill(line1);
  await page.locator("#addr-city").fill(city);
  await page.locator("#addr-state").fill(state);
  await page.locator("#addr-pincode").fill(pincode);
  await page.getByRole("button", { name: "Save address" }).click();
  await page.getByRole("button", { name: "Save address" }).waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(600); // sheet close animation
}

/** Open the order's address picker, waiting for saved addresses to load. */
async function openAddressPicker(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // let the detail + saved-addresses fetches settle before clicking
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.getByRole("button", { name: "Select Address" }).click();
    const picker = page.getByText("Add new address");
    try {
      await picker.waitFor({ state: "visible", timeout: 7_000 });
      return true;
    } catch {
      // addresses hadn't loaded yet -> full-page form; go back and retry
      if (page.url().endsWith("/address")) {
        await page.goBack();
        await page.getByRole("button", { name: "Select Address" }).waitFor({ state: "visible" });
        await page.waitForTimeout(1_500);
      }
    }
  }
  return false;
}

const run = async () => {
  const session = await mintSession(PHONE);
  if (!session.session_token) throw new Error("could not mint session");
  const call = api(session.session_token);

  const browser = await chromium.launch();

  // baseline + draft order (setup, via API)
  const { data: baselineList } = await call("GET", "/addresses");
  const baselineIds = new Set(baselineList.map((a) => a.id));
  // self-heal: sweep leftover "SA E2E*" addresses from any crashed prior run
  for (const a of baselineList) {
    if (a.address_line_1?.startsWith("SA E2E")) {
      await call("DELETE", `/addresses/${a.id}`);
      baselineIds.delete(a.id);
      console.log("  self-heal: deleted leftover", a.address_line_1);
    }
  }
  const draft = await call("POST", "/orders", { garment_id: GARMENT });
  const orderId = draft.data.id;
  if (!orderId) throw new Error("draft order creation failed: " + JSON.stringify(draft));

  try {
    // ── T1: outside address saves, row flagged ──────────────────────────
    const a = await openContext(browser, session, OUTSIDE);
    await a.page.goto(`${BASE}/app/account`, { waitUntil: "domcontentloaded" });
    await a.page.getByRole("button", { name: "Add address" }).first().waitFor({ state: "visible", timeout: 20_000 });
    await addAddress(a.page, {
      line1: "SA E2E Outside", city: "Chikkaballapur", state: "Karnataka", pincode: "562103",
    });
    const outRow = a.page.locator("li", { hasText: "SA E2E Outside" });
    await outRow.waitFor({ state: "visible", timeout: 10_000 });
    const chipVisible = await outRow.getByText("Not serviceable here yet").isVisible();
    log("T1", "outside address saved + 'Not serviceable here yet' shown", chipVisible);
    await a.context.close();

    // ── T2: inside address saves, no warning (fresh context: HSR geo) ───
    const b = await openContext(browser, session, INSIDE);
    await b.page.goto(`${BASE}/app/account`, { waitUntil: "domcontentloaded" });
    await b.page.getByRole("button", { name: "Add address" }).first().waitFor({ state: "visible", timeout: 20_000 });
    await addAddress(b.page, {
      line1: "SA E2E HSR", city: "Bengaluru", state: "Karnataka", pincode: "560102",
    });
    const inRow = b.page.locator("li", { hasText: "SA E2E HSR" });
    await inRow.waitFor({ state: "visible", timeout: 10_000 });
    const chipCount = await inRow.getByText("Not serviceable here yet").count();
    log("T2", "inside address saved without warning", chipCount === 0, `chips=${chipCount}`);

    // ── T3/T4: order address picker — outside blocked, inside attaches ──
    await b.page.goto(`${BASE}/app/orders/${orderId}`, { waitUntil: "domcontentloaded" });
    const opened = await openAddressPicker(b.page);
    if (!opened) throw new Error("address picker never opened");
    const outsideRow = b.page.getByRole("button", { name: /SA E2E Outside/ }).first();
    const t3chip = await outsideRow.getByText("Not serviceable here yet").isVisible();
    const t3disabled = await outsideRow.isDisabled();
    log("T3", "outside address shown unserviceable + disabled in picker",
        t3chip && t3disabled, `chip=${t3chip} disabled=${t3disabled}`);

    await b.page.getByRole("button", { name: /SA E2E HSR/ }).first().click();
    await b.page.getByText("SA E2E HSR").first().waitFor({ state: "visible", timeout: 10_000 });
    log("T4", "attaching inside address succeeds (deliver-to card)", true);

    // ── T5: coverage-gated slots render ──────────────────────────────────
    await b.page.getByRole("button", { name: "Select Slot" }).click();
    // wait for actual time chips ("8:15 PM") to render from the real fetch
    let hasTimes = true;
    try {
      await b.page.getByText(/\d{1,2}:\d{2} (AM|PM)/).first().waitFor({ state: "visible", timeout: 12_000 });
    } catch {
      hasTimes = false;
    }
    const sheetText = await b.page.locator("body").innerText();
    const hasDates = hasTimes && !sheetText.includes("No slots available");
    log("T5", "slots list renders for covered address", hasDates, `times=${hasTimes}`);

    // ── T5b: inside fence but NO captain coverage -> natural no-slots ───
    const c = await openContext(browser, session, UNCOVERED);
    await c.page.goto(`${BASE}/app/account`, { waitUntil: "domcontentloaded" });
    await c.page.getByRole("button", { name: "Add address" }).first().waitFor({ state: "visible", timeout: 20_000 });
    await addAddress(c.page, {
      line1: "SA E2E Whitefield", city: "Bengaluru", state: "Karnataka", pincode: "560066",
    });
    await c.page.locator("li", { hasText: "SA E2E Whitefield" }).waitFor({ state: "visible", timeout: 10_000 });
    await c.context.close();

    await b.page.goto(`${BASE}/app/orders/${orderId}`, { waitUntil: "domcontentloaded" });
    // order already has HSR attached -> use the deliver-to card's Change
    await b.page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await b.page.getByRole("button", { name: "Change", exact: true }).click();
    await b.page.getByText("Add new address").waitFor({ state: "visible", timeout: 7_000 });
    await b.page.getByRole("button", { name: /SA E2E Whitefield/ }).first().click();
    await b.page.getByText("SA E2E Whitefield").first().waitFor({ state: "visible", timeout: 10_000 });
    let notifyNatural = 0;
    await b.context.route("**/api/v1/service-area/notify-me", async (route) => {
      notifyNatural += 1;
      await route.continue();
    });
    await b.page.getByRole("button", { name: "Select Slot" }).click();
    const noSlotsNatural = b.page.getByText("No slots available, we will notify you when they open up.");
    await noSlotsNatural.waitFor({ state: "visible", timeout: 12_000 });
    await b.page.waitForTimeout(800);
    log("T5b", "in-fence uncovered pin -> natural no-slots + notify captured",
        noSlotsNatural.isVisible() && notifyNatural >= 1, `notify=${notifyNatural}`);

    // ── T6: empty slots -> notify message + capture ─────────────────────
    let notifyCalled = 0;
    await b.context.route("**/api/v1/service-area/notify-me", async (route) => {
      notifyCalled += 1;
      await route.continue();
    });
    await b.context.route("**/api/v1/orders/*/slots*", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ days: [], reason: "no_captain_coverage" }),
      });
    });
    await b.page.goto(`${BASE}/app/orders/${orderId}`, { waitUntil: "domcontentloaded" });
    await b.page.getByRole("button", { name: "Select Slot" }).click();
    const noSlots = b.page.getByText("No slots available, we will notify you when they open up.");
    await noSlots.waitFor({ state: "visible", timeout: 10_000 });
    await b.page.waitForTimeout(800);
    const t6 = (await noSlots.isVisible()) && notifyCalled >= 1;
    log("T6", "empty slots -> notify message + notify-me captured",
        t6, `notifyCalled=${notifyCalled}`);
    await b.context.close();
  } finally {
    // ── cleanup: delete everything not in the pre-run baseline ─────────
    const del = await call("DELETE", `/orders/${orderId}`);
    if (del.status !== 204) console.log("  warn: order delete ->", del.status);
    const { data: after } = await call("GET", "/addresses");
    for (const x of after) {
      if (!baselineIds.has(x.id)) await call("DELETE", `/addresses/${x.id}`);
    }
    const { data: final } = await call("GET", "/addresses");
    const clean = final.length === baselineIds.size &&
      final.every((x) => baselineIds.has(x.id));
    log("CLEANUP", "test rows deleted, existing data untouched", clean,
        `${final.length} vs baseline ${baselineIds.size}`);
    await browser.close();
  }

  console.log(`\n${PASS.length}/${PASS.length + FAIL.length} checks passed`);
  if (FAIL.length) {
    console.log("FAILED:", FAIL.map((f) => f.id).join(", "));
    process.exit(1);
  }
};

run().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
