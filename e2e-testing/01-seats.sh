#!/bin/bash
# Test: Seat querying and filtering
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 01 — Seat Queries & Filters"
echo "========================================="

# 1. Get all seats
info "Fetching all seats for event $EVENT_ID..."
response=$(request GET "/events/${EVENT_ID}/seats")
assert_status "$response" 200 "List seats"

# 2. Filter by status
info "Fetching AVAILABLE seats..."
response=$(request GET "/events/${EVENT_ID}/seats?status=AVAILABLE")
assert_status "$response" 200 "List AVAILABLE seats"

# 3. Filter by section
info "Fetching Orchestra seats..."
response=$(request GET "/events/${EVENT_ID}/seats?section=Orchestra")
assert_status "$response" 200 "List Orchestra seats"

# 4. Get stats
info "Fetching seat stats..."
response=$(request GET "/events/${EVENT_ID}/seats/stats")
assert_status "$response" 200 "Seat stats"

body=$(get_body "$response")
echo "  Stats: $body"

# 5. Re-generate (idempotent — upsert, same result)
info "Re-generating seats (idempotency test)..."
response=$(request POST "/events/${EVENT_ID}/seats/generate")
assert_status "$response" 201 "Generate seats (idempotent)"

echo ""
echo "Done."
