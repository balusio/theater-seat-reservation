#!/bin/bash
# Test: Monitoring and audit trail
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 08 — Monitoring & Audit Trail"
echo "========================================="

# 1. Get monitoring stats
info "Fetching monitoring stats..."
response=$(request GET /monitoring/stats)
assert_status "$response" 200 "Monitoring stats"

body=$(get_body "$response")

echo ""
echo "  Reservations:"
echo "    Pending:   $(echo "$body" | jq '.reservations.pending')"
echo "    Confirmed: $(echo "$body" | jq '.reservations.confirmed')"
echo "    Cancelled: $(echo "$body" | jq '.reservations.cancelled')"
echo "    Rejected:  $(echo "$body" | jq '.reservations.rejected')"
echo "    Total:     $(echo "$body" | jq '.reservations.total')"

echo ""
echo "  Seats:"
echo "    Available: $(echo "$body" | jq '.seats.available')"
echo "    Held:      $(echo "$body" | jq '.seats.held')"
echo "    Booked:    $(echo "$body" | jq '.seats.booked')"
echo "    Total:     $(echo "$body" | jq '.seats.total')"

echo ""
echo "  System:"
echo "    Uptime:    $(echo "$body" | jq '.uptime')s"
echo "    RSS:       $(echo "$body" | jq '.memory.rss') bytes"

echo ""
echo "  Recent Activity (last 5):"
echo "$body" | jq -r '.recentActivity[:5][] | "    [\(.triggeredBy)] \(.action) — \(.previousStatus // "null") → \(.newStatus)"'

echo ""
echo "Done."
