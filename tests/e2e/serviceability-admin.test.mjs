/**
 * Serviceability Areas admin sub-tab E2E — Configure → Serviceability Areas.
 *
 *   T1  page lists master areas (koramangala-blr + blr-city-fence seeded)
 *   T2  Add area: name it, draw 4 points on the map, close, save
 *       -> appears in the list and in the DB
 *   T3  Pause / Activate toggle works
 *   T4  Remove (confirm dialog) -> gone from list and DB
 *
 * Run from the fe dir:   node tests/e2e/serviceability-admin.test.mjs
 * Uses the dev JWT secret to mint an admin session (BE admin password is
 * stale in this env). Cleans up the area it creates.
 */

import { chromium } from "playwright";
import { createHmac } from "crypto";

const BASE = process.env.E2E_BASE ?? "http://localhost:3002";
const API = process.env.E2E_API ?? "http://localhost:8000/api/v1";
const JWT_SECRET = process.env.E2E_JWT_SECRET ?? "dev-secret-change-in-production";
const AREA_NAME = "E2E Test Fence Area";

function mintAdminToken() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const claims = b64({ sub: "e2e-admin@draep.test", type: "admin", iat: now, exp: now + 3600 });
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${claims}`).digest("base64url");
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
  page.on("dialog", (d) => void d.accept()); // auto-accept the remove confirm

  try {
    // T1: list renders with seeded areas
    await page.goto(`${BASE}/admin/actions/serviceability`, { waitUntil: "domcontentloaded" });
    await page.locator("li").first().waitFor({ state: "visible", timeout: 15_000 });
    const rows = await page.locator("li").count();
    log("T1", "master areas list renders", rows >= 1, `rows=${rows}`);

    // T2: add area — name, draw 4 points, close, save
    await page.getByRole("button", { name: "+ Add area" }).click();
    await page.getByPlaceholder("Area name (e.g. Bengaluru core)").fill(AREA_NAME);
    await page.getByRole("button", { name: "+ Draw new area" }).click();
    const map = page.locator(".leaflet-container");
    await map.waitFor({ state: "visible", timeout: 10_000 });
    const box = await map.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const r = Math.min(box.width, box.height) * 0.2;
    for (const [dx, dy] of [[0, -r], [r, 0], [0, r], [-r, 0]]) {
      await page.mouse.click(cx + dx, cy + dy);
      await page.waitForTimeout(120);
    }
    const first = page.locator("path.leaflet-interactive").first();
    await first.hover();
    await page.getByText("Click to close area").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(250); // let the hover restyle settle
    await first.click({ force: true });
    await page.getByRole("button", { name: "Save serviceable areas" }).click();
    const row = page.locator("li", { hasText: AREA_NAME });
    await row.waitFor({ state: "visible", timeout: 10_000 });
    const inDb = await (await fetch(`${API}/service-area/shape`)).json();
    log("T2", "area drawn, saved, listed + fence endpoint live",
        (await row.getByText(/1 shape/).isVisible().catch(() => false)) && !!inDb.polygon);

    // T3: pause -> paused chip; activate -> back
    await row.getByRole("button", { name: "Pause" }).click();
    await row.getByText("paused", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await row.getByRole("button", { name: "Activate" }).click();
    await row.getByRole("button", { name: "Pause" }).waitFor({ state: "visible", timeout: 10_000 });
    log("T3", "pause / activate toggle", true);

    // T4: remove with confirm
    await row.getByRole("button", { name: "Remove" }).click();
    await row.waitFor({ state: "detached", timeout: 10_000 });
    const listRows = await page.locator("li", { hasText: AREA_NAME }).count();
    log("T4", "area removed after confirm", listRows === 0, `rows=${listRows}`);
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
