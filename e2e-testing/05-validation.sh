#!/bin/bash
# Test: Input validation and error handling
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 05 — Validation & Error Handling"
echo "========================================="

# 1. Missing fields
info "Empty body..."
response=$(request POST /reservations '{}')
assert_status "$response" 400 "Empty body returns 400"

# 2. Invalid idempotencyKey (not UUID)
info "Invalid idempotencyKey..."
response=$(request POST /reservations '{
  "idempotencyKey": "not-a-uuid",
  "eventId": 1,
  "seatIds": [1]
}')
assert_status "$response" 400 "Invalid UUID returns 400"

# 3. Empty seatIds
info "Empty seatIds array..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$(uuidgen | tr '[:upper:]' '[:lower:]')\",
  \"eventId\": 1,
  \"seatIds\": []
}")
assert_status "$response" 400 "Empty seatIds returns 400"

# 4. Non-existent reservation
info "Get non-existent reservation..."
response=$(request GET "/reservations/00000000-0000-0000-0000-000000000000")
assert_status "$response" 404 "Non-existent returns 404"

# 5. Confirm non-existent
info "Confirm non-existent reservation..."
response=$(request POST "/reservations/00000000-0000-0000-0000-000000000000/confirm" "{
  \"idempotencyKey\": \"$(uuidgen | tr '[:upper:]' '[:lower:]')\"
}")
assert_status "$response" 409 "Confirm non-existent returns 409"

echo ""
echo "Done."
