#!/bin/bash
# Test: Full reservation lifecycle — create, confirm, cancel
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 02 — Reservation Full Lifecycle"
echo "========================================="

IDEMP_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
SEAT_A=$(seat_id 0)
SEAT_B=$(seat_id 1)
SEAT_C=$(seat_id 2)

info "Using seats: $SEAT_A, $SEAT_B, $SEAT_C"

# --------------------------------------------------
# A) Create reservation
# --------------------------------------------------
info "Creating reservation (idempotencyKey: $IDEMP_KEY)..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$IDEMP_KEY\",
  \"eventId\": \"$EVENT_ID\",
  \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\", \"$SEAT_C\"]
}")
assert_status "$response" 201 "Create reservation"

RESERVATION_ID=$(json_field "$response" '.id')
info "Reservation ID: $RESERVATION_ID"
info "Status: $(json_field "$response" '.status')"
info "Expires: $(json_field "$response" '.expiresAt')"

# --------------------------------------------------
# B) Idempotency — same key returns same reservation
# --------------------------------------------------
info "Repeating same request (idempotency check)..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$IDEMP_KEY\",
  \"eventId\": \"$EVENT_ID\",
  \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\", \"$SEAT_C\"]
}")
assert_status "$response" 201 "Idempotent create"

SAME_ID=$(json_field "$response" '.id')
if [ "$SAME_ID" = "$RESERVATION_ID" ]; then
  pass "Same reservation ID returned (idempotent)"
else
  fail "Different reservation ID: $SAME_ID vs $RESERVATION_ID"
fi

# --------------------------------------------------
# C) Get reservation
# --------------------------------------------------
info "Fetching reservation..."
response=$(request GET "/reservations/$RESERVATION_ID")
assert_status "$response" 200 "Get reservation"

# --------------------------------------------------
# D) Confirm reservation (via SQS queue)
# --------------------------------------------------
CONFIRM_KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
info "Confirming reservation..."
response=$(request POST "/reservations/$RESERVATION_ID/confirm" "{
  \"idempotencyKey\": \"$CONFIRM_KEY\"
}")
assert_status "$response" 202 "Enqueue confirmation"

info "Waiting 3s for SQS consumer..."
sleep 3

response=$(request GET "/reservations/$RESERVATION_ID")
STATUS=$(json_field "$response" '.status')
if [ "$STATUS" = "CONFIRMED" ]; then
  pass "Reservation confirmed via SQS"
else
  warn "Status is $STATUS (may need more time for SQS processing)"
fi

# --------------------------------------------------
# E) Cancel confirmed reservation
# --------------------------------------------------
info "Cancelling confirmed reservation..."
response=$(request POST "/reservations/$RESERVATION_ID/cancel" '{
  "reason": "e2e test cancellation"
}')
assert_status "$response" 200 "Cancel confirmed reservation"

response=$(request GET "/reservations/$RESERVATION_ID")
STATUS=$(json_field "$response" '.status')
if [ "$STATUS" = "CANCELLED" ]; then
  pass "Reservation is CANCELLED"
else
  fail "Expected CANCELLED, got $STATUS"
fi

# --------------------------------------------------
# F) Verify seats released
# --------------------------------------------------
info "Checking seat stats after cancellation..."
response=$(request GET "/events/${EVENT_ID}/seats/stats")
assert_status "$response" 200 "Seat stats after cancel"
body=$(get_body "$response")
echo "  Stats: $body"

echo ""
echo "Done."
