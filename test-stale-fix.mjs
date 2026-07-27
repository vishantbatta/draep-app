// API-level test: verify the stale orderId fix end-to-end
// Tests the exact scenario: user has stale orderId → OTP verify → PUT contact

import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Helper: call API from the browser context (so auth tokens are shared)
async function apiCall(method, path, body, token) {
  return page.evaluate(
    async ({ method, path, body, token }) => {
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`http://localhost:8000/api/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
    { method, path, body, token },
  );
}

console.log("=== Test: Stale orderId fix (API-level) ===\n");

// 1. Bootstrap via the web app (creates anonymous session)
console.log("1. Bootstrapping...");
await page.goto(BASE, { waitUntil: "networkidle" });
await sleep(3000);

const anonToken = await page.evaluate(() => {
  const raw = localStorage.getItem("draep-auth");
  return raw ? JSON.parse(raw)?.state?.token : null;
});
console.log("   Anonymous token:", anonToken ? "✓" : "✗");

// 2. Create an anonymous order
console.log("\n2. Creating anonymous order...");
const orderRes = await apiCall("POST", "/orders", {
  garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
}, anonToken);
const orderId = orderRes.json.id;
console.log("   Order:", orderId, "(status:", orderRes.status + ")");

// 3. OTP verify with a STALE order_id (one that doesn't exist)
console.log("\n3. OTP verify with STALE order_id...");
const STALE = "deadbeef-dead-beef-dead-beefdeadbeef";
const verifyRes1 = await apiCall("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: STALE,
}, anonToken);
console.log("   Status:", verifyRes1.status);
console.log("   active_order_id:", verifyRes1.json?.active_order_id);
console.log("   user.id:", verifyRes1.json?.user?.id);

const userToken1 = verifyRes1.json?.session_token;
const activeId1 = verifyRes1.json?.active_order_id;

// The stale order_id doesn't exist → backend should fall to Path C
// (return existing draft, or null if none)
if (activeId1 === STALE) {
  console.error("   ✗ FAIL: active_order_id matches stale ID (shouldn't happen)");
  process.exit(1);
}

// 4. Now try to PUT contact with the correct active_order_id
if (activeId1) {
  console.log("\n4. PUT contact with active_order_id...");
  const contactRes = await apiCall("PUT", `/orders/${activeId1}/contact`, {
    name: "Test User",
    address_line_1: "123 Test St",
    address_line_2: "",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    lat: 12.9116,
    lng: 77.6564,
  }, userToken1);
  console.log("   Status:", contactRes.status);
  if (contactRes.status >= 400) {
    console.error("   ✗ FAIL:", JSON.stringify(contactRes.json));
    process.exit(1);
  }
  console.log("   ✓ Contact saved");
} else {
  console.log("\n4. active_order_id is null (no existing draft)");
  console.log("   Frontend would clearDraft() + initDraft() to create new order");

  // Create a new order as the authenticated user
  const newOrder = await apiCall("POST", "/orders", {
    garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
  }, userToken1);
  console.log("   New order:", newOrder.json?.id);

  const contactRes = await apiCall("PUT", `/orders/${newOrder.json.id}/contact`, {
    name: "Test User",
    address_line_1: "123 Test St",
    address_line_2: "",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    lat: 12.9116,
    lng: 77.6564,
  }, userToken1);
  console.log("   PUT contact status:", contactRes.status);
  if (contactRes.status >= 400) {
    console.error("   ✗ FAIL:", JSON.stringify(contactRes.json));
    process.exit(1);
  }
  console.log("   ✓ Contact saved on new order");
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: Already-owned order re-verify
// ═══════════════════════════════════════════════════════════════
console.log("\n=== Test: Re-verify with already-owned order_id ===\n");

// Create new anon session
const anon2 = await apiCall("POST", "/auth/anonymous", undefined, null);
const anonToken2 = anon2.json.session_token;

// Create order
const order2 = await apiCall("POST", "/orders", {
  garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
}, anonToken2);
const orderId2 = order2.json.id;
console.log("5. Created order:", orderId2);

// OTP verify — re-parents order2 to user
const verify2 = await apiCall("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: orderId2,
}, anonToken2);
console.log("6. OTP verify: active_order_id =", verify2.json?.active_order_id);

// Now verify AGAIN with the SAME order_id (already owned)
// New anon session
const anon3 = await apiCall("POST", "/auth/anonymous", undefined, null);
const anonToken3 = anon3.json.session_token;

console.log("\n7. Re-verify with already-owned order_id...");
const verify3 = await apiCall("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: orderId2, // already owned by user, should still be draft
}, anonToken3);
console.log("   active_order_id:", verify3.json?.active_order_id);

if (verify3.json?.active_order_id === orderId2) {
  console.log("   ✓ Backend returned the same order_id (Path B working)");
} else {
  console.log("   ⚠ Got different active_order_id:", verify3.json?.active_order_id);
}

// PUT contact should work
const userToken3 = verify3.json?.session_token;
const contact3 = await apiCall("PUT", `/orders/${verify3.json?.active_order_id}/contact`, {
  name: "Test",
  address_line_1: "789 St",
  address_line_2: "",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  lat: 12.9116,
  lng: 77.6564,
}, userToken3);
console.log("   PUT contact:", contact3.status);
if (contact3.status >= 400) {
  console.error("   ✗ FAIL:", JSON.stringify(contact3.json));
  process.exit(1);
}
console.log("   ✓ Contact saved");

console.log("\n✓ All tests passed!");
await browser.close();
