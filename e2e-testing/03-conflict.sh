#!/bin/bash
# Test: Conflict detection — double booking the same seats
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 03 — Conflict Detection (Double Booking)"
echo "========================================="

KEY1=$(uuidgen | tr '[:upper:]' '[:lower:]')
KEY2=$(uuidgen | tr '[:upper:]' '[:lower:]')

SEAT_A=$(seat_id 10)
SEAT_B=$(seat_id 11)

info "Using seats: $SEAT_A, $SEAT_B"

# --------------------------------------------------
# A) First reservation — should succeed
# --------------------------------------------------
info "First reservation for seats..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$KEY1\",
  \"eventId\": \"$EVENT_ID\",
  \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\"]
}")
assert_status "$response" 201 "First reservation"
RES1_ID=$(json_field "$response" '.id')
info "Reservation 1: $RES1_ID"

# --------------------------------------------------
# B) Second reservation for SAME seats — should 409
# --------------------------------------------------
info "Second reservation for same seats (should conflict)..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$KEY2\",
  \"eventId\": \"$EVENT_ID\",
  \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\"]
}")
assert_status "$response" 409 "Conflict on double booking"

# --------------------------------------------------
# C) Cancel first, then retry second
# --------------------------------------------------
info "Cancelling first reservation..."
response=$(request POST "/reservations/$RES1_ID/cancel" '{"reason":"free seats for retry"}')
assert_status "$response" 201 "Cancel first reservation"

info "Retrying second reservation after cancel..."
response=$(request POST /reservations "{
  \"idempotencyKey\": \"$KEY2\",
  \"eventId\": \"$EVENT_ID\",
  \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\"]
}")
assert_status "$response" 201 "Retry after cancel succeeds"
RES2_ID=$(json_field "$response" '.id')
info "Reservation 2: $RES2_ID"

# Cleanup
request POST "/reservations/$RES2_ID/cancel" '{"reason":"cleanup"}' > /dev/null

echo ""
echo "Done."
