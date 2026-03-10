#!/bin/bash
# Test: Seat generation and querying
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 01 — Seat Generation & Queries"
echo "========================================="

# 1. Generate seats for event
info "Generating seats for event $EVENT_ID..."
response=$(request POST "/events/${EVENT_ID}/seats/generate")
assert_status "$response" 201 "Generate seats"

generated=$(json_field "$response" '.generated')
info "Generated: $generated seats"

# 2. Generate again (idempotent — should succeed with same result)
info "Re-generating seats (idempotency test)..."
response=$(request POST "/events/${EVENT_ID}/seats/generate")
assert_status "$response" 201 "Generate seats (idempotent)"

# 3. Get all seats
info "Fetching all seats for event $EVENT_ID..."
response=$(request GET "/events/${EVENT_ID}/seats")
assert_status "$response" 200 "List seats"

# 4. Filter by status
info "Fetching AVAILABLE seats..."
response=$(request GET "/events/${EVENT_ID}/seats?status=AVAILABLE")
assert_status "$response" 200 "List AVAILABLE seats"

# 5. Filter by section
info "Fetching Orchestra seats..."
response=$(request GET "/events/${EVENT_ID}/seats?section=Orchestra")
assert_status "$response" 200 "List Orchestra seats"

# 6. Get stats
info "Fetching seat stats..."
response=$(request GET "/events/${EVENT_ID}/seats/stats")
assert_status "$response" 200 "Seat stats"

body=$(get_body "$response")
echo "  Stats: $body"

echo ""
echo "Done."
