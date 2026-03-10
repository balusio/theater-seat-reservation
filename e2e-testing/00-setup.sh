#!/bin/bash
# Setup: generate seats and export UUIDs for other scripts
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 00 — Setup (generate seats + fetch IDs)"
echo "========================================="

# 1. Health check
info "Checking server..."
response=$(request GET /health)
assert_status "$response" 200 "Health check" || exit 1

# 2. Generate event seats
info "Generating seats for event $EVENT_ID..."
response=$(request POST "/events/${EVENT_ID}/seats/generate")
assert_status "$response" 201 "Generate seats" || exit 1

generated=$(json_field "$response" '.generated')
info "Generated: $generated seats"

# 3. Fetch all seat UUIDs and write to data file
info "Fetching seat UUIDs..."
response=$(request GET "/events/${EVENT_ID}/seats")
body=$(get_body "$response")

# Flatten all section arrays into a single array of seat IDs
echo "$body" | jq '[.[] | .[].id]' > "$DATA_FILE"

SEAT_COUNT=$(jq 'length' "$DATA_FILE")
info "Wrote $SEAT_COUNT seat UUIDs to $DATA_FILE"

# 4. Verify we have enough seats
if [ "$SEAT_COUNT" -lt 50 ]; then
  warn "Only $SEAT_COUNT seats available — some parallel tests may need adjustment"
fi

# 5. Monitoring stats
info "Checking monitoring..."
response=$(request GET /monitoring/stats)
assert_status "$response" 200 "Monitoring stats"

# 6. Dashboard
info "Checking dashboard..."
response=$(request GET /monitoring/dashboard)
assert_status "$response" 200 "Dashboard"

echo ""
echo "Done. Seat data: $DATA_FILE"
