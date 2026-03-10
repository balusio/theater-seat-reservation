#!/bin/bash
# Shared configuration for all test scripts

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Seed event IDs (must match prisma/seed.ts)
EVENT_ID="${EVENT_ID:-b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e}"

# Shared data file (populated by 00-setup.sh)
DATA_FILE="/tmp/e2e-seats.json"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Helper: make a request and capture status + body
request() {
  local method=$1
  local path=$2
  local body=$3

  if [ -n "$body" ]; then
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "${BASE_URL}${path}"
  else
    curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      "${BASE_URL}${path}"
  fi
}

get_status() { echo "$1" | tail -1; }
get_body()   { echo "$1" | sed '$d'; }

assert_status() {
  local response=$1
  local expected=$2
  local label=$3
  local status
  status=$(get_status "$response")

  if [ "$status" = "$expected" ]; then
    pass "$label (HTTP $status)"
  else
    fail "$label — expected HTTP $expected, got HTTP $status"
    echo "  Body: $(get_body "$response")"
    return 1
  fi
}

json_field() {
  echo "$1" | sed '$d' | jq -r "$2" 2>/dev/null
}

# Read seat UUID from the data file by index (0-based)
seat_id() {
  jq -r ".[$1]" "$DATA_FILE" 2>/dev/null
}
