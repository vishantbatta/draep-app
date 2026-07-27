/**
 * Test: Go through tying step in the UI and check if selection persists to backend.
 * Uses direct API for setup + UI for the tying step specifically.
 */
import { chromium } from "playwright";
import assert from "assert";

const FRONTEND = "http://localhost:3000";
const BACKEND = "http://localhost:8000/api/v1";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// ─── Setup: Create order via API with all critical selections ──────────────
console.log("=== SETUP: Create order with all criticals except tying ===\n");

const anonRes = await api("POST", "/auth/anonymous");
const token = anonRes.json.session_token;

const listRes = await api("GET", "/catalog/garments", null, token);
const garmentId = listRes.json.items.find((g) => g.slug === "blouse").id;

const treeRes = await api("GET", `/catalog/garments/${garmentId}`, null, token);
const tree = treeRes.json;

const orderRes = await api("POST", "/orders", { garment_id: garmentId }, token);
const orderId = orderRes.json.id;
console.log("Order:", orderId);

// Add all critical selections EXCEPT tying
const criticalComps = tree.components.filter((c) => c.importance === "critical");
for (const comp of criticalComps) {
  if (comp.labels?.en === "Tying mechanism") continue;
  const variation = comp.variations[0];
  let vtId = null;
  if (variation.variation_types?.length > 0) vtId = variation.variation_types[0].id;
  await api("PUT", `/orders/${orderId}/selections/${comp.id}`, {
    variation_id: variation.id, variation_type_id: vtId,
  }, token);
  console.log(`  ✓ ${comp.labels.en}`);
}

// Validate — should FAIL because tying is missing
const val1 = await api("POST", `/orders/${orderId}/validate`, null, token);
console.log("\nValidation without tying:", val1.json.valid ? "PASS (BUG!)" : "FAIL (expected)");
if (!val1.json.valid) {
  console.log("  Issues:", val1.json.issues.map(i => i.message));
}

// ─── Now use the UI to add the tying selection ─────────────────────────────
console.log("\n=== UI TEST: Add tying mechanism via UI ===\n");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

// Set cookie BEFORE navigating (middleware checks this)
await context.addCookies([{
  name: "draep_draft",
  value: "1",
  domain: "localhost",
  path: "/",
  expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
}]);

// Inject the auth token and draft into localStorage
console.log("   token =", token?.substring(0, 20) + "...");
console.log("   orderId =", orderId);
const initScript = `
  (function() {
    const t = ${JSON.stringify(token)};
    const oid = ${JSON.stringify(orderId)};
    const draft = {
      version: 1,
      orderId: oid,
      garmentId: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
      selections: {},
      addOns: {},
      serverPriceBreakdown: null,
      updatedAt: new Date().toISOString(),
    };
    const draftState = { state: { draft }, version: 1 };
    const authState = {
      state: {
        token: t,
        sessionType: "anonymous",
        user: null,
        activeOrderId: oid,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      version: 0,
    };
    window.localStorage.setItem("draep-booking-draft", JSON.stringify(draftState));
    window.localStorage.setItem("draep-auth", JSON.stringify(authState));
    window.localStorage.setItem("draep_session_token", t);
    console.log("INIT SCRIPT: draft.orderId =", draft.orderId, "oid =", oid);
    const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = "draep_draft=1; expires=" + exp + "; path=/; SameSite=Lax";
  })();
`;
await context.addInitScript(initScript);

const page = await context.newPage();

// Capture API calls
const selectionPuts = [];
page.on("request", (req) => {
  if (req.url().includes("/selections/") && req.method() === "PUT") {
    selectionPuts.push({
      url: req.url().replace(BACKEND, ""),
      body: req.postData(),
    });
  }
});

const consoleErrors = [];
const consoleLogs = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
  if (msg.text().includes("INIT SCRIPT")) consoleLogs.push(msg.text());
});

try {
  console.log("1. Navigate to / first (to avoid middleware redirect)...");
  await page.goto(`${FRONTEND}/`, { waitUntil: "networkidle" });
  await sleep(2000);

  // Check orderId survived
  const oid1 = await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("draep-booking-draft") || "{}");
    return raw?.state?.draft?.orderId;
  });
  console.log("   orderId after /:", oid1);

  // Now navigate to tying
  console.log("\n2. Navigate to /design/tying...");
  await page.goto(`${FRONTEND}/design/tying`, { waitUntil: "networkidle" });
  await sleep(3000);
  console.log("   URL:", page.url());

  // Check if page loaded
  const title = await page.locator("h1, h2, h3").first().textContent().catch(() => "N/A");
  console.log("   Page title:", title);

  // Check draft state in localStorage before clicking
  const draftBefore = await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("draep-booking-draft") || "{}");
    return raw;
  });
  console.log("   Full persisted state before click:", JSON.stringify(draftBefore, null, 2).substring(0, 500));

  // Find and click the first option card (Hook)
  console.log("\n2. Clicking 'Hook' option...");
  const hookCard = page.locator("text=Hook").first();
  if (await hookCard.isVisible({ timeout: 5000 }).catch(() => false)) {
    await hookCard.click();
    await sleep(1000);
    console.log("   Clicked Hook");

    // Check draft state after clicking
    const draftAfter = await page.evaluate(() => {
      const raw = JSON.parse(window.localStorage.getItem("draep-booking-draft") || "{}");
      return raw?.state?.draft;
    });
    console.log("   Draft after click:", JSON.stringify({
      orderId: draftAfter?.orderId,
      selections: draftAfter?.selections,
    }, null, 2));

    // Check if sub-option chips appeared
    const chips = page.locator("text=Front hook").first();
    if (await chips.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log("   Sub-options visible");
    }
  } else {
    console.log("   Hook card not found!");
  }

  // Capture ALL network requests around "Next" click
  const allRequests = [];
  page.on("request", (req) => {
    if (req.url().includes("localhost:8000")) {
      allRequests.push({ method: req.method(), url: req.url().replace(BACKEND, "") });
    }
  });

  // Click "Next" to flush pending changes
  console.log("\n3. Clicking Next...");
  const nextBtn = page.locator("button:has-text('Next')").first();
  if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nextBtn.click();
    await sleep(5000); // Wait longer for flush
    console.log("   Clicked Next, now at:", page.url().replace(FRONTEND, ""));
  } else {
    console.log("   Next button not found!");
  }

  // Check what calls were made
  console.log("\n4. ALL API calls after Next:");
  for (const r of allRequests) {
    console.log(`   ${r.method} ${r.url}`);
  }

  console.log("\n   Selection PUT calls specifically:");
  if (selectionPuts.length === 0) {
    console.log("   NONE! This is the bug - tying selection was NOT flushed!");
  } else {
    for (const c of selectionPuts) {
      console.log(`   PUT ${c.url} body=${c.body}`);
    }
  }

  // Check draft state after Next
  const draftFinal = await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("draep-booking-draft") || "{}");
    return raw?.state?.draft;
  });
  console.log("\n   Draft after Next:", JSON.stringify({
    orderId: draftFinal?.orderId,
    selections: draftFinal?.selections,
  }, null, 2));

  // Now validate the order on the backend
  console.log("\n5. Backend validation after UI interaction...");
  const val2 = await api("POST", `/orders/${orderId}/validate`, null, token);
  console.log("   valid:", val2.json.valid);
  if (!val2.json.valid) {
    console.log("   Issues:", val2.json.issues.map(i => i.message));
  }

  // Check the order items on backend
  console.log("\n6. Backend order items:");
  const orderCheck = await api("GET", `/orders/${orderId}`, null, token);
  if (orderCheck.json.garment_orders?.[0]?.items) {
    for (const item of orderCheck.json.garment_orders[0].items) {
      console.log(`   ${item.type}: comp=${item.garment_style_component_id} var=${item.variation_id}`);
    }
  }

  console.log("\nConsole errors:", consoleErrors.length ? consoleErrors : "None");
  console.log("Init script logs:", consoleLogs.length ? consoleLogs : "NONE - init script didn't run!");

} catch (err) {
  console.error("TEST ERROR:", err.message);
  console.log("Console errors:", consoleErrors);
} finally {
  await browser.close();
}
