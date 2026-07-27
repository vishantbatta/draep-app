// test-no-block.mjs
// Verifies that payment is NOT blocked when critical components (like tying mechanism) are missing.
// The validate endpoint should return valid:true with informational issues only,
// and checkout should proceed without raising order_invalid.

import assert from "node:assert";

const BASE = "http://localhost:8000/api/v1";

async function main() {
  console.log("=== TEST: Payment not blocked by missing critical components ===\n");

  // 1. Anonymous session
  const sessRes = await fetch(`${BASE}/auth/anonymous`, { method: "POST" });
  assert.ok([200, 201].includes(sessRes.status), `session failed: ${sessRes.status}`);
  const sess = await sessRes.json();
  const token = sess.session_token;
  console.log("1. Anonymous session:", sessRes.status);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // 2. Create order
  const orderRes = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify({ garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e" }),
  });
  assert.equal(orderRes.status, 201, `create order failed: ${orderRes.status}`);
  const order = await orderRes.json();
  console.log("2. Order created:", order.id);

  // 3. Add ONLY some critical selections (skip tying mechanism)
  const selections = [
    // Front neck cut
    { component_id: "16410d34-70f0-4209-9ccc-ee7ad515d800", variation_id: "f21ecc8c-eb36-4ba3-9a6e-e44327fccb7b" },
    // Blouse cut
    { component_id: "373b8160-2348-4722-94ac-f0a11ea1bf59", variation_id: "02a6ad76-8a32-430a-afa9-e859c23a986d" },
    // Blouse length
    { component_id: "ee00c2d5-67d6-4316-af9c-ed07acdbff60", variation_id: "94d5f928-80e9-4f49-b567-9a95803645f2" },
    // Back cut
    { component_id: "9680c9ec-d41e-47b1-95fe-e44ac82b332f", variation_id: "42cccce9-9dbf-44fc-8456-cf23b689a822" },
    // NOTE: Tying mechanism intentionally MISSING
  ];

  for (const sel of selections) {
    const res = await fetch(`${BASE}/orders/${order.id}/selections/${sel.component_id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ variation_id: sel.variation_id }),
    });
    assert.equal(res.status, 200, `selection ${sel.component_id} failed: ${res.status}`);
  }
  console.log("3. Added 4 critical selections (tying mechanism MISSING)");

  // 4. Validate — should return valid:true now (informational issues only)
  const valRes = await fetch(`${BASE}/orders/${order.id}/validate`, {
    method: "POST",
    headers,
  });
  assert.equal(valRes.status, 200, `validate failed: ${valRes.status}`);
  const validation = await valRes.json();
  console.log("4. Validation result:");
  console.log("   valid:", validation.valid);
  console.log("   issues:", JSON.stringify(validation.issues, null, 2));

  // KEY ASSERTION: valid must be true even with missing tying mechanism
  assert.equal(
    validation.valid,
    true,
    "FAIL: validate_order should return valid:true even when tying mechanism is missing",
  );
  console.log("\n   ✓ Validation returns valid:true (does not block)");

  // 5. Attempt checkout — should NOT raise order_invalid
  const idempotencyKey = crypto.randomUUID();
  const checkoutRes = await fetch(`${BASE}/checkout/${order.id}`, {
    method: "POST",
    headers: {
      ...headers,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ advance_policy: "advance_only" }),
  });

  console.log("\n5. Checkout status:", checkoutRes.status);

  if (checkoutRes.status === 409) {
    const body = await checkoutRes.json();
    console.log("   Response:", JSON.stringify(body, null, 2));
    assert.fail(
      `FAIL: Checkout blocked with 409 — payment should not be blocked by missing selections. Code: ${body.code || body.detail?.code}`,
    );
  }

  // Any non-409 status is a pass for this test (200, 201, or even payment gateway errors)
  assert.ok(
    checkoutRes.status !== 409,
    `FAIL: Checkout should not be blocked (got ${checkoutRes.status})`,
  );

  const checkoutBody = await checkoutRes.json().catch(() => ({}));
  console.log("   Checkout response keys:", Object.keys(checkoutBody));

  console.log("\n═════════════════════════════════════════════");
  console.log("  ✓✓✓ PAYMENT NOT BLOCKED — TEST PASSED!");
  console.log("═════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("\n✗ TEST FAILED:", err.message);
  process.exit(1);
});
