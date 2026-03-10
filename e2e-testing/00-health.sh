#!/bin/bash
# Test: Health check and connectivity
source "$(dirname "$0")/config.sh"

echo "========================================="
echo " 00 — Health & Connectivity"
echo "========================================="

# 1. Health endpoint
info "Checking /health..."
response=$(request GET /health)
assert_status "$response" 200 "Health check"

# 2. Monitoring stats
info "Checking /monitoring/stats..."
response=$(request GET /monitoring/stats)
assert_status "$response" 200 "Monitoring stats"

# 3. Monitoring dashboard
info "Checking /monitoring/dashboard..."
response=$(request GET /monitoring/dashboard)
assert_status "$response" 200 "Monitoring dashboard"

echo ""
echo "Done."
