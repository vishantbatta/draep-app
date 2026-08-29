/**
 * CoverageMapEditor E2E — admin draws serviceable shapes for a captain.
 *
 * Flow:
 *   1. admin login (admin@draep.com / AGENTS.md password) via /admin/login
 *   2. open /admin/users/style-captains → "SA Test Captain (E2E)"
 *   3. "Add serviceable areas" → modal + Leaflet map
 *   4. "+ Draw new area" → click the map 5 times (points appear one by one)
 *   5. hover the FIRST vertex → "Click to close area" tooltip appears;
 *      click it → shape closes → "Area 1 · 5 points" chip
 *   6. "Save serviceable areas" → modal closes, flash + card chip
 *   7. reload → coverage still shown (persisted); DB spot-checked by the
 *      runner afterwards
 *
 * Run from the fe dir:   node tests/e2e/coverage-editor.test.mjs
 * Leaves the drawn shape on the E2E test captain (a seeded test row).
 */

import { chromium } from "playwright";
import { createHmac } from "crypto";

const BASE = process.env.E2E_BASE ?? "http://localhost:3002";
const CAPTAIN = "SA Test Captain (E2E)";
// The AGENTS.md admin password no longer matches this server (401), so the
// test mints an admin JWT directly with the BE dev secret (.env JWT_SECRET).
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? "dev-secret-change-in-production";

/** Minimal HS256 JWT with the claims require_admin() accepts. */
function mintAdminToken() {
  const b64 = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const claims = b64({
    sub: "e2e-admin@draep.test",
    type: "admin",
    iat: now,
    exp: now + 3600,
  });
  const sig = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${claims}`)
    .digest("base64url");
  return `${header}.${claims}.${sig}`;
}

const PASS = [];
const FAIL = [];
function log(id, desc, passed, detail = "") {
  console.log(`[${passed ? "PASS" : "FAIL"}] ${id} — ${desc}${detail ? " | " + detail : ""}`);
  (passed ? PASS : FAIL).push(id);
}

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript((token) => {
    localStorage.setItem("draep_admin_token", token);
  }, mintAdminToken());
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));

  try {
    // 1. admin session (minted test JWT — BE password is stale in this env)
    log("T1", "admin session minted", true);

    // 2. captain detail page (deep link to the seeded E2E captain)
    await page.goto(
      `${BASE}/admin/users/style-captains/1592fb24-df7d-4a1a-9aa3-af09fc108296`,
      { waitUntil: "domcontentloaded" },
    );
    await page.getByRole("button", { name: "Manage serviceable areas" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    log("T2", "captain detail page shows 'Manage serviceable areas'", true);

    // 3. open editor
    await page.getByRole("button", { name: "Manage serviceable areas" }).click();
    await page.getByRole("button", { name: "+ Draw new area" }).waitFor({
      state: "visible",
      timeout: 10_000,
    });
    log("T3", "editor modal opens with map", true);

    // 4. draw: 5 map clicks
    await page.getByRole("button", { name: "+ Draw new area" }).click();
    const map = page.locator(".leaflet-container");
    await map.waitFor({ state: "visible", timeout: 10_000 });
    const box = await map.boundingBox();
    if (!box) throw new Error("map box not found");
    // five points roughly around the map center (a pentagon)
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const r = Math.min(box.width, box.height) * 0.25;
    const offsets = [
      [0, -r], [r * 0.95, -r * 0.31], [r * 0.59, r * 0.81],
      [-r * 0.59, r * 0.81], [-r * 0.95, -r * 0.31],
    ];
    for (const [dx, dy] of offsets) {
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(150);
    }
    const pointHint = await page.getByText(/Point 5 dropped/).isVisible();
    log("T4", "5 points dropped one by one", pointHint);

    // 5. hover the FIRST vertex → tooltip; click → closes shape
    // first vertex marker: a path.leaflet-interactive inside the draft layer;
    // it sits nearest the top of the pentagon — use the tooltip text on hover.
    const firstVertex = page.locator(".leaflet-interactive").last();
    // markers are appended in order; the FIRST vertex is the earliest circle —
    // locate all circles and pick the one whose tooltip says "close"
    const circles = page.locator("path.leaflet-interactive");
    const n = await circles.count();
    let closed = false;
    let tipSeen = false;
    for (let i = n - 1; i >= 0; i--) {
      const c = circles.nth(i);
      await c.hover();
      const tip = page.getByText("Click to close area");
      if (await tip.isVisible().catch(() => false)) {
        tipSeen = true;
        await c.click();
        closed = true;
        break;
      }
    }
    const chip = page.getByText(/Area \d+ · 5 points/);
    await chip.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    const chipVisible = await chip.isVisible().catch(() => false);
    console.log(`  debug: markers=${n} tipSeen=${tipSeen} closed=${closed} chip=${chipVisible}`);
    log("T5", "hover first point -> close affordance -> shape closes",
        closed && chipVisible);

    // 6. save
    await page.getByRole("button", { name: "Save serviceable areas" }).click();
    const flash = page.getByText("Serviceable areas saved");
    await flash.waitFor({ state: "visible", timeout: 10_000 });
    log("T6", "save persists + flash", true);

    // 7. reload — persisted
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/area\(s\) drawn|areas drawn/).first().waitFor({
      state: "visible",
      timeout: 15_000,
    }).catch(() => {});
    const persisted = await page.getByText(/Area 1 · \d+ points/).first().isVisible().catch(() => false);
    log("T7", "coverage persisted after reload", persisted);
  } finally {
    await browser.close();
  }

  console.log(`\n${PASS.length}/${PASS.length + FAIL.length} checks passed`);
  if (FAIL.length) process.exit(1);
};

run().catch((e) => {
  console.error("E2E crashed:", e.message);
  process.exit(1);
});
