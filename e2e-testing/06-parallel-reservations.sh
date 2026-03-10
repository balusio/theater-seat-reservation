#!/bin/bash
# Test: Parallel concurrent reservations — stress test for race conditions
# Simulates multiple users trying to reserve seats at the same time
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 06 — Parallel Concurrent Reservations"
echo "========================================="

NUM_PARALLEL="${1:-10}"  # Number of parallel requests (default 10)
SEAT_START="${2:-30}"     # Starting seat ID to use

info "Running $NUM_PARALLEL parallel reservations..."
info "All competing for seats [$SEAT_START, $((SEAT_START + 1))]"
echo ""

TMPDIR=$(mktemp -d)
PIDS=()

# Launch parallel requests — all trying to book the SAME seats
for i in $(seq 1 "$NUM_PARALLEL"); do
  KEY=$(uuidgen | tr '[:upper:]' '[:lower:]')
  (
    result=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Content-Type: application/json" \
      -d "{
        \"idempotencyKey\": \"$KEY\",
        \"eventId\": $EVENT_ID,
        \"seatIds\": [$SEAT_START, $((SEAT_START + 1))]
      }" \
      "${BASE_URL}/reservations")

    status=$(echo "$result" | tail -1)
    body=$(echo "$result" | sed '$d')
    echo "$status|$body" > "$TMPDIR/result_$i"
  ) &
  PIDS+=($!)
done

# Wait for all to finish
for pid in "${PIDS[@]}"; do
  wait "$pid"
done

# Analyze results
WINS=0
CONFLICTS=0
ERRORS=0

for i in $(seq 1 "$NUM_PARALLEL"); do
  result=$(cat "$TMPDIR/result_$i")
  status=$(echo "$result" | cut -d'|' -f1)
  body=$(echo "$result" | cut -d'|' -f2-)

  case "$status" in
    201) WINS=$((WINS + 1));     echo -e "  Request $i: ${GREEN}201 — Reserved${NC}" ;;
    409) CONFLICTS=$((CONFLICTS + 1)); echo -e "  Request $i: ${YELLOW}409 — Conflict${NC}" ;;
    *)   ERRORS=$((ERRORS + 1));  echo -e "  Request $i: ${RED}$status — Error${NC}: $body" ;;
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
  warn "No winners — seats may already be taken. Try different SEAT_START."
elif [ "$WINS" -gt 1 ]; then
  fail "DOUBLE BOOKING DETECTED! $WINS requests succeeded for same seats."
else
  warn "Unexpected results: $WINS wins, $CONFLICTS conflicts, $ERRORS errors"
fi

# Cleanup temp files
rm -rf "$TMPDIR"

# Cleanup — cancel the winning reservation
if [ "$WINS" -ge 1 ]; then
  for i in $(seq 1 "$NUM_PARALLEL"); do
    result=$(cat "$TMPDIR/result_$i" 2>/dev/null || echo "")
    status=$(echo "$result" | cut -d'|' -f1)
    if [ "$status" = "201" ]; then
      body=$(echo "$result" | cut -d'|' -f2-)
      RES_ID=$(echo "$body" | jq -r '.id' 2>/dev/null)
      if [ -n "$RES_ID" ] && [ "$RES_ID" != "null" ]; then
        request POST "/reservations/$RES_ID/cancel" '{"reason":"cleanup after parallel test"}' > /dev/null
        info "Cleaned up reservation $RES_ID"
      fi
      break
    fi
  done
fi

echo ""
echo "Done."
