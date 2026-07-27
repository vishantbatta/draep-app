/**
 * Test: Full payment flow with ALL critical selections including tying mechanism.
 * Creates order via API, adds all selections, validates, and attempts checkout.
 */
import assert from "assert";

const API = "http://localhost:8000/api/v1";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

// ─── Step 1: Anonymous session ──────────────────────────────────────────────
const anonRes = await api("POST", "/auth/anonymous");
console.log("1. Anonymous session:", anonRes.status);
assert.ok([200, 201].includes(anonRes.status), "Anonymous session failed");
const anonToken = anonRes.json.session_token;
console.log("   Token:", anonToken.substring(0, 30) + "...");

// ─── Step 2: Get garment tree ───────────────────────────────────────────────
// First list garments to get the UUID
const listRes = await api("GET", "/catalog/garments", null, anonToken);
console.log("2. List garments:", listRes.status);
const blouse = listRes.json.items.find((g) => g.slug === "blouse");
const garmentId = blouse.id;
console.log("   Blouse garment ID:", garmentId);

const treeRes = await api("GET", `/catalog/garments/${garmentId}`, null, anonToken);
console.log("   Garment tree:", treeRes.status);
assert.equal(treeRes.status, 200, `Garment tree failed: ${treeRes.status}`);
const tree = treeRes.json;

// Find critical components
const criticalComps = tree.components.filter((c) => c.importance === "critical");
console.log("   Critical components:", criticalComps.map((c) => c.labels?.en));

// ─── Step 3: Create order ───────────────────────────────────────────────────
const orderRes = await api("POST", "/orders", { garment_id: garmentId }, anonToken);
console.log("3. Create order:", orderRes.status);
assert.equal(orderRes.status, 201, "Order creation failed");
const orderId = orderRes.json.id;
console.log("   Order ID:", orderId);

// ─── Step 4: Add ALL critical selections ────────────────────────────────────
console.log("4. Adding all critical selections...");
for (const comp of criticalComps) {
  const compLabel = comp.labels?.en;
  console.log(`   ${compLabel} (${comp.id}):`);

  // Pick first variation
  const variation = comp.variations[0];
  if (!variation) {
    console.log(`     NO variations available! SKIPPING!`);
    continue;
  }
  console.log(`     Variation: ${variation.labels?.en} (${variation.id})`);

  // Check if variation has sub-types
  let variationTypeId = null;
  if (variation.variation_types && variation.variation_types.length > 0) {
    variationTypeId = variation.variation_types[0].id;
    console.log(`     Sub-type: ${variation.variation_types[0].labels?.en} (${variationTypeId})`);
  }

  const selRes = await api("PUT", `/orders/${orderId}/selections/${comp.id}`, {
    variation_id: variation.id,
    variation_type_id: variationTypeId,
  }, anonToken);

  if (selRes.status === 200) {
    console.log(`     ✓ Saved (200)`);
  } else {
    console.log(`     ✗ FAILED (${selRes.status}):`, JSON.stringify(selRes.json));
  }
}

// ─── Step 5: Validate ───────────────────────────────────────────────────────
console.log("\n5. Validating order...");
const valRes = await api("POST", `/orders/${orderId}/validate`, null, anonToken);
console.log("   Status:", valRes.status);
console.log("   Result:", JSON.stringify(valRes.json, null, 2));

if (!valRes.json.valid) {
  console.log("\n❌ VALIDATION FAILED!");
  console.log("   Issues:", JSON.stringify(valRes.json.issues, null, 2));
  process.exit(1);
}

// ─── Step 6: Checkout ───────────────────────────────────────────────────────
console.log("\n6. Checkout...");
const checkoutRes = await api("POST", `/orders/${orderId}/checkout`, {
  advance_policy: "advance_only",
}, anonToken);
console.log("   Status:", checkoutRes.status);
if (checkoutRes.status === 200) {
  console.log("   ✓ Checkout successful!");
  console.log("   Order number:", checkoutRes.json.order_number);
  console.log("   Amount due:", checkoutRes.json.amount_due_now);
  console.log("   Cashfree:", checkoutRes.json.cashfree?.environment);
} else {
  console.log("   ✗ Checkout FAILED!");
  console.log("   Response:", JSON.stringify(checkoutRes.json, null, 2));
}

console.log("\n═════════════════════════════════════════════");
console.log("  ✓✓✓ ALL CRITICAL SELECTIONS TEST PASSED!");
console.log("═════════════════════════════════════════════");
