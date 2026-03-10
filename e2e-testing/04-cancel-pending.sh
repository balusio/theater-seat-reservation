#!/bin/bash
# Test: Cancel a PENDING reservation (no confirm step)
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 04 — Cancel Pending Reservation"
echo "========================================="

KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
SEAT=20

# Create
info "Creating reservation..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$KEY\",
  \"eventId\": $EVENT_ID,
  \"seatIds\": [$SEAT]
}")
assert_status "$response" 201 "Create reservation"
RES_ID=$(json_field "$response" '.id')

# Cancel directly from PENDING
info "Cancelling from PENDING..."
response=$(request POST "/reservations/$RES_ID/cancel" '{"reason":"changed my mind"}')
assert_status "$response" 200 "Cancel pending"

# Verify
response=$(request GET "/reservations/$RES_ID")
STATUS=$(json_field "$response" '.status')
if [ "$STATUS" = "CANCELLED" ]; then
  pass "Status is CANCELLED"
else
  fail "Expected CANCELLED, got $STATUS"
fi

# Try to cancel again (should fail — CANCELLED is terminal)
info "Cancelling again (should fail)..."
response=$(request POST "/reservations/$RES_ID/cancel" '{}')
assert_status "$response" 409 "Cannot cancel already cancelled"

echo ""
echo "Done."
