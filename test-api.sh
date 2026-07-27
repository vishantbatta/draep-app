#!/bin/bash
# Test: returning user with stale orderId
set -e
API="http://localhost:8000/api/v1"

echo "=== Test: Returning user with stale orderId ==="
echo ""

# Step 1: Create anonymous session
ANON_RESP=$(/usr/bin/curl -s -X POST "$API/auth/anonymous" -H "Content-Type: application/json")
ANON_TOKEN=$(echo "$ANON_RESP" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
echo "1. Anonymous session created"

# Step 2: Create order
ORDER_RESP=$(/usr/bin/curl -s -X POST "$API/orders" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN" -d '{"garment_id":"4dcd2822-ab9d-4c1e-be29-81e0c7c8291e"}')
ORDER_ID=$(echo "$ORDER_RESP" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "2. Created order: $ORDER_ID"

# Step 3: OTP verify with order_id
VERIFY_RESP=$(/usr/bin/curl -s -X POST "$API/auth/otp/verify" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN" -d "{\"phone\":\"9876543210\",\"country_code\":\"+91\",\"otp\":\"123456\",\"order_id\":\"$ORDER_ID\"}")
USER_TOKEN=$(echo "$VERIFY_RESP" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
ACTIVE_ORDER=$(echo "$VERIFY_RESP" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('active_order_id') or 'None')")
echo "3. OTP verify: active_order_id=$ACTIVE_ORDER"

# Step 4: Contact save with correct order
CONTACT_STATUS=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/orders/$ACTIVE_ORDER/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN" -d '{"name":"Test","address_line_1":"123 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560001","lat":12.9116,"lng":77.6564}')
echo "4. PUT contact (correct order): $CONTACT_STATUS"

# Step 5: New anonymous session for second flow
ANON_RESP2=$(/usr/bin/curl -s -X POST "$API/auth/anonymous" -H "Content-Type: application/json")
ANON_TOKEN2=$(echo "$ANON_RESP2" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
echo "5. New anonymous session"

# Step 6: Create second order
ORDER_RESP2=$(/usr/bin/curl -s -X POST "$API/orders" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN2" -d '{"garment_id":"4dcd2822-ab9d-4c1e-be29-81e0c7c8291e"}')
ORDER_ID2=$(echo "$ORDER_RESP2" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "6. Created second order: $ORDER_ID2"

# Step 7: OTP verify with second order_id
VERIFY_RESP2=$(/usr/bin/curl -s -X POST "$API/auth/otp/verify" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN2" -d "{\"phone\":\"9876543210\",\"country_code\":\"+91\",\"otp\":\"123456\",\"order_id\":\"$ORDER_ID2\"}")
USER_TOKEN2=$(echo "$VERIFY_RESP2" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
ACTIVE_ORDER2=$(echo "$VERIFY_RESP2" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('active_order_id') or 'None')")
echo "7. OTP verify (second): active_order_id=$ACTIVE_ORDER2"

# Step 8: Try to PUT contact with FIRST order (now stale — cancelled by step 7)
echo ""
echo "8. PUT contact with FIRST (stale) order..."
STALE_RESP=$(/usr/bin/curl -s -w "\nHTTP:%{http_code}" -X PUT "$API/orders/$ORDER_ID/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN2" -d '{"name":"Test2","address_line_1":"456 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560002","lat":12.9116,"lng":77.6564}')
echo "   $STALE_RESP"

# Step 9: Try with second order
echo "9. PUT contact with SECOND (correct) order..."
GOOD_RESP=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/orders/$ORDER_ID2/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN2" -d '{"name":"Test2","address_line_1":"456 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560002","lat":12.9116,"lng":77.6564}')
echo "   HTTP: $GOOD_RESP"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "=== Test: OTP verify WITHOUT order_id (old code path) ==="
# Create anon + order
ANON_RESP3=$(/usr/bin/curl -s -X POST "$API/auth/anonymous")
ANON_TOKEN3=$(echo "$ANON_RESP3" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
ORDER_RESP3=$(/usr/bin/curl -s -X POST "$API/orders" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN3" -d '{"garment_id":"4dcd2822-ab9d-4c1e-be29-81e0c7c8291e"}')
ORDER_ID3=$(echo "$ORDER_RESP3" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "10. Created order: $ORDER_ID3"

# Verify WITHOUT order_id
VERIFY_RESP3=$(/usr/bin/curl -s -X POST "$API/auth/otp/verify" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN3" -d '{"phone":"9876543210","country_code":"+91","otp":"123456"}')
USER_TOKEN3=$(echo "$VERIFY_RESP3" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
ACTIVE3=$(echo "$VERIFY_RESP3" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('active_order_id') or 'None')")
echo "11. OTP verify (no order_id): active=$ACTIVE3"

# Try to PUT contact using ORDER_ID3
CONTACT3=$(/usr/bin/curl -s -w "\nHTTP:%{http_code}" -X PUT "$API/orders/$ORDER_ID3/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN3" -d '{"name":"Test3","address_line_1":"789 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560003","lat":12.9116,"lng":77.6564}')
echo "12. PUT contact: $CONTACT3"

# ═══════════════════════════════════════════════════════════════
echo ""
echo "=== Test: Returning user re-verifying with already-owned order ==="
# ORDER_ID was re-parented in step 3, possibly cancelled in step 7.
# Now a third anon session tries to verify with ORDER_ID again.
ANON_RESP4=$(/usr/bin/curl -s -X POST "$API/auth/anonymous")
ANON_TOKEN4=$(echo "$ANON_RESP4" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")
echo "13. Verify with already-owned order_id ($ORDER_ID)..."
VERIFY_RESP4=$(/usr/bin/curl -s -X POST "$API/auth/otp/verify" -H "Content-Type: application/json" -H "Authorization: Bearer $ANON_TOKEN4" -d "{\"phone\":\"9876543210\",\"country_code\":\"+91\",\"otp\":\"123456\",\"order_id\":\"$ORDER_ID\"}")
ACTIVE4=$(echo "$VERIFY_RESP4" | /usr/bin/python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('active_order_id') or 'None')")
USER_TOKEN4=$(echo "$VERIFY_RESP4" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get('session_token',''))")
echo "    active_order_id: $ACTIVE4"
echo "    (if None → frontend keeps stale orderId → Order not found on PUT!)"

if [ "$ACTIVE4" != "None" ]; then
  CONTACT4=$(/usr/bin/curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/orders/$ACTIVE4/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN4" -d '{"name":"Test4","address_line_1":"999 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560004","lat":12.9116,"lng":77.6564}')
  echo "    PUT contact with active_order_id: $CONTACT4"
fi

# Also try PUT with the ORIGINAL stale ORDER_ID and new token
CONTACT4B=$(/usr/bin/curl -s -w "\nHTTP:%{http_code}" -X PUT "$API/orders/$ORDER_ID/contact" -H "Content-Type: application/json" -H "Authorization: Bearer $USER_TOKEN4" -d '{"name":"Test4","address_line_1":"999 St","address_line_2":"","city":"Bengaluru","state":"Karnataka","pincode":"560004","lat":12.9116,"lng":77.6564}')
echo "    PUT contact with stale order_id: $CONTACT4B"
