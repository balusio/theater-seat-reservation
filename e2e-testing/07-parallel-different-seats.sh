#!/bin/bash
# Test: Parallel reservations for DIFFERENT seats — all should succeed
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 07 — Parallel Reservations (Different Seats)"
echo "========================================="

NUM_PARALLEL="${1:-10}"
SEAT_OFFSET=40

info "Running $NUM_PARALLEL parallel reservations for DIFFERENT seats..."
echo ""

TMPDIR=$(mktemp -d)
PIDS=()

for i in $(seq 1 "$NUM_PARALLEL"); do
  KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
  SEAT=$(seat_id $((SEAT_OFFSET + i)))
  (
    result=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "{
        \"idempotencyKey\": \"$KEY\",
        \"eventId\": \"$EVENT_ID\",
        \"seatIds\": [\"$SEAT\"]
      }" \
      "${BASE_URL}/reservations")

    status=$(echo "$result" | tail -1)
    body=$(echo "$result" | sed '$d')
    echo "$status|$body" > "$TMPDIR/result_$i"
  ) &
  PIDS+=($!)
done

for pid in "${PIDS[@]}"; do
  wait "$pid"
done

WINS=0
FAILS=0
RES_IDS=()

for i in $(seq 1 "$NUM_PARALLEL"); do
  result=$(cat "$TMPDIR/result_$i")
  status=$(echo "$result" | cut -d'|' -f1)
  body=$(echo "$result" | cut -d'|' -f2-)

  if [ "$status" = "201" ]; then
    WINS=$((WINS + 1))
    RES_ID=$(echo "$body" | jq -r '.id' 2>/dev/null)
    RES_IDS+=("$RES_ID")
    echo -e "  Request $i: ${GREEN}201 — Seat $((SEAT_OFFSET + i))${NC}"
  else
    FAILS=$((FAILS + 1))
    echo -e "  Request $i: ${RED}$status${NC}: $body"
  fi
done

echo ""
if [ "$WINS" -eq "$NUM_PARALLEL" ]; then
  pass "All $NUM_PARALLEL reservations succeeded — no false conflicts!"
else
  warn "$WINS/$NUM_PARALLEL succeeded, $FAILS failed"
fi

# Cleanup
for res_id in "${RES_IDS[@]}"; do
  if [ -n "$res_id" ] && [ "$res_id" != "null" ]; then
    request POST "/reservations/$res_id/cancel" '{"reason":"cleanup"}' > /dev/null
  fi
done
info "Cleaned up ${#RES_IDS[@]} reservations"

rm -rf "$TMPDIR"

echo ""
echo "Done."
