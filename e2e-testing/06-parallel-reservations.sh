#!/bin/bash
# Test: Parallel concurrent reservations — stress test for race conditions
# Simulates multiple users trying to reserve the SAME seats at the same time
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 06 — Parallel Concurrent Reservations"
echo "========================================="

NUM_PARALLEL="${1:-10}"
SEAT_A=$(seat_id 30)
SEAT_B=$(seat_id 31)

info "Running $NUM_PARALLEL parallel reservations..."
info "All competing for seats: $SEAT_A, $SEAT_B"
echo ""

TMPDIR=$(mktemp -d)
PIDS=()

for i in $(seq 1 "$NUM_PARALLEL"); do
  KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
  (
    result=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "{
        \"idempotencyKey\": \"$KEY\",
        \"eventId\": \"$EVENT_ID\",
        \"seatIds\": [\"$SEAT_A\", \"$SEAT_B\"]
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

# Analyze results
WINS=0
CONFLICTS=0
ERRORS=0
WINNER_FILE=""

for i in $(seq 1 "$NUM_PARALLEL"); do
  result=$(cat "$TMPDIR/result_$i")
  status=$(echo "$result" | cut -d'|' -f1)

  case "$status" in
    201)
      WINS=$((WINS + 1))
      WINNER_FILE="$TMPDIR/result_$i"
      echo -e "  Request $i: ${GREEN}201 — Reserved${NC}"
      ;;
    409)
      CONFLICTS=$((CONFLICTS + 1))
      echo -e "  Request $i: ${YELLOW}409 — Conflict${NC}"
      ;;
    *)
      ERRORS=$((ERRORS + 1))
      body=$(echo "$result" | cut -d'|' -f2-)
      echo -e "  Request $i: ${RED}$status — Error${NC}: $body"
      ;;
  esac
done

echo ""
echo "========================================="
echo " Results: $NUM_PARALLEL parallel requests"
echo "========================================="
echo -e "  ${GREEN}Wins:${NC}      $WINS"
echo -e "  ${YELLOW}Conflicts:${NC} $CONFLICTS"
echo -e "  ${RED}Errors:${NC}    $ERRORS"
echo ""

if [ "$WINS" -eq 1 ] && [ "$CONFLICTS" -eq $((NUM_PARALLEL - 1)) ]; then
  pass "Exactly 1 winner, rest got conflicts — no double booking!"
elif [ "$WINS" -eq 0 ]; then
  warn "No winners — seats may already be taken"
elif [ "$WINS" -gt 1 ]; then
  fail "DOUBLE BOOKING DETECTED! $WINS requests succeeded for same seats."
else
  warn "Unexpected results: $WINS wins, $CONFLICTS conflicts, $ERRORS errors"
fi

# Cleanup — cancel the winning reservation
if [ -n "$WINNER_FILE" ]; then
  result=$(cat "$WINNER_FILE")
  body=$(echo "$result" | cut -d'|' -f2-)
  RES_ID=$(echo "$body" | jq -r '.id' 2>/dev/null)
  if [ -n "$RES_ID" ] && [ "$RES_ID" != "null" ]; then
    request POST "/reservations/$RES_ID/cancel" '{"reason":"cleanup after parallel test"}' > /dev/null
    info "Cleaned up reservation $RES_ID"
  fi
fi

rm -rf "$TMPDIR"

echo ""
echo "Done."
