#!/bin/bash
# Run all E2E tests in sequence

DIR="$(dirname "$0")"
source "$DIR/config.sh"

echo "╔═══════════════════════════════════════════╗"
echo "║   Theater Seat Reservation — E2E Tests    ║"
echo "╠═══════════════════════════════════════════╣"
echo "║   Base URL: $BASE_URL"
echo "║   Event ID: $EVENT_ID"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Check jq is installed
if ! command -v jq &> /dev/null; then
  fail "jq is required. Install: brew install jq"
  exit 1
fi

# Setup must succeed before running tests
info "Running setup..."
bash "$DIR/00-setup.sh"
if [ $? -ne 0 ]; then
  fail "Setup failed — aborting tests"
  exit 1
fi

TESTS=(
  "01-seats.sh"
  "02-reservation-flow.sh"
  "03-conflict.sh"
  "04-cancel-pending.sh"
  "05-validation.sh"
  "06-parallel-reservations.sh"
  "07-parallel-different-seats.sh"
  "08-monitoring.sh"
)

PASSED=0
FAILED=0

for test in "${TESTS[@]}"; do
  echo ""
  bash "$DIR/$test"
  if [ $? -eq 0 ]; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║               SUMMARY                     ║"
echo "╠═══════════════════════════════════════════╣"
echo -e "║   ${GREEN}Passed:${NC} $PASSED"
echo -e "║   ${RED}Failed:${NC} $FAILED"
echo "╚═══════════════════════════════════════════╝"
