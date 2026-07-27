// Direct API test — reproduce "Order not found" without browser
const API = "http://localhost:8000/api/v1";

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

console.log("=== Test: Returning user with stale orderId ===\n");

// Step 1: Create anonymous session
const anonRes = await api("POST", "/auth/anonymous");
const anonToken = anonRes.json.session_token;
console.log("1. Anonymous session:", anonRes.status);

// Step 2: Create order (anonymous)
const orderRes = await api("POST", "/orders", {
  garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
}, anonToken);
const orderId = orderRes.json.id;
console.log("2. Created order:", orderId);

// Step 3: OTP verify with order_id — re-parents order to user
const verifyRes = await api("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: orderId,
}, anonToken);
const userToken = verifyRes.json.session_token;
const activeOrderId = verifyRes.json.active_order_id;
console.log("3. OTP verify:", verifyRes.status);
console.log("   active_order_id:", activeOrderId);
console.log("   user.id:", verifyRes.json.user?.id);

// Step 4: User can save contact on the re-parented order
const contactRes1 = await api("PUT", `/orders/${activeOrderId}/contact`, {
  name: "Test User",
  address_line_1: "123 Test St",
  address_line_2: "",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  lat: 12.9116,
  lng: 77.6564,
}, userToken);
console.log("4. PUT contact (correct order):", contactRes1.status);

// Step 5: Now user comes BACK for a new flow. New anonymous session.
const anonRes2 = await api("POST", "/auth/anonymous");
const anonToken2 = anonRes2.json.session_token;
console.log("\n5. New anonymous session for second flow");

// Step 6: Create a SECOND order
const orderRes2 = await api("POST", "/orders", {
  garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
}, anonToken2);
const orderId2 = orderRes2.json.id;
console.log("6. Created second order:", orderId2);

// Step 7: OTP verify with the NEW order_id
const verifyRes2 = await api("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: orderId2,
}, anonToken2);
const userToken2 = verifyRes2.json.session_token;
const activeOrderId2 = verifyRes2.json.active_order_id;
console.log("7. OTP verify (second flow):", verifyRes2.status);
console.log("   active_order_id:", activeOrderId2);
console.log("   Same user?", verifyRes2.json.user?.id === verifyRes.json.user?.id);

// Step 8: Now try to save contact using the FIRST order ID (stale)
console.log("\n8. Trying to PUT contact with FIRST (stale) order ID...");
const contactRes2 = await api("PUT", `/orders/${orderId}/contact`, {
  name: "Test User 2",
  address_line_1: "456 Other St",
  address_line_2: "",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560002",
  lat: 12.9116,
  lng: 77.6564,
}, userToken2);
console.log("   Status:", contactRes2.status);
console.log("   Response:", JSON.stringify(contactRes2.json));

// Step 9: Try with the correct (second) order ID
console.log("\n9. Trying to PUT contact with SECOND (correct) order ID...");
const contactRes3 = await api("PUT", `/orders/${orderId2}/contact`, {
  name: "Test User 2",
  address_line_1: "456 Other St",
  address_line_2: "",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560002",
  lat: 12.9116,
  lng: 77.6564,
}, userToken2);
console.log("   Status:", contactRes3.status);
console.log("   Response:", JSON.stringify(contactRes3.json).slice(0, 200));

// ═══════════════════════════════════════════════════════════════════
// Now test: what if the frontend DIDN'T send order_id (old code path)?
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Test: OTP verify WITHOUT order_id ===\n");

// Create anon session + order
const anonRes3 = await api("POST", "/auth/anonymous");
const orderRes3 = await api("POST", "/orders", {
  garment_id: "4dcd2822-ab9d-4c1e-be29-81e0c7c8291e",
}, anonRes3.json.session_token);
const orderId3 = orderRes3.json.id;
console.log("10. Created order:", orderId3);

// OTP verify WITHOUT order_id
const verifyRes3 = await api("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  // NO order_id!
}, anonRes3.json.session_token);
console.log("11. OTP verify (no order_id):", verifyRes3.status);
console.log("    active_order_id:", verifyRes3.json.active_order_id);

// Try to save contact using orderId3
const contactRes4 = await api("PUT", `/orders/${orderId3}/contact`, {
  name: "Test User 3",
  address_line_1: "789 Test St",
  address_line_2: "",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560003",
  lat: 12.9116,
  lng: 77.6564,
}, verifyRes3.json.session_token);
console.log("12. PUT contact:", contactRes4.status);
console.log("    Response:", JSON.stringify(contactRes4.json).slice(0, 200));

// ═══════════════════════════════════════════════════════════════════
// Test: what if user sends a CANCELLED order_id?
// ═══════════════════════════════════════════════════════════════════
console.log("\n=== Test: OTP verify with CANCELLED order_id ===\n");

// orderId was re-parented in step 3. Now it might get cancelled when
// orderId2 is re-parented (via _cancel_existing_user_drafts).
// Let's check: try to verify with orderId again (it's now owned + possibly cancelled)
const verifyRes4 = await api("POST", "/auth/otp/verify", {
  phone: "9876543210",
  country_code: "+91",
  otp: "123456",
  order_id: orderId,  // This was re-parented in step 3 and maybe cancelled in step 7
}, anonRes3.json.session_token);
console.log("13. OTP verify with old order_id:", verifyRes4.status);
console.log("    active_order_id:", verifyRes4.json.active_order_id);
console.log("    (if null, frontend keeps stale orderId → Order not found!)");
