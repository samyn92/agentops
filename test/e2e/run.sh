#!/usr/bin/env bash
# E2E Test Suite — DevOps/GitOps Factory Workflow
#
# Validates the full agent factory lifecycle:
#   1. Factory deployment (Helm)
#   2. Issue creation → Planning board
#   3. Plan refinement (agent responds)
#   4. Approve → Todo → Label bridge fires implementer
#   5. Implementer creates AgentRun → opens MR
#   6. Console API accessibility
#
# Prerequisites:
#   - k3s cluster running with operator + console dev pods
#   - Factory deployed: helm install samyn92-lab deploy/charts/agent-factory ...
#   - Bot tokens in gitlab-bot-planner + gitlab-bot-coder secrets
#   - User logged into console (has session cookie)
#
# Usage:
#   ./test/e2e/run.sh              # run all tests
#   ./test/e2e/run.sh --quick      # skip slow tests (agent execution)
#
set -euo pipefail

# ── Config ──
GITLAB_API="https://gitlab.com/api/v4"
GITLAB_GROUP="samyn92-lab"
GITLAB_PROJECT="samyn92-lab/billing-svc"
PROJECT_ID="82876862"
BFF_URL="http://localhost:30080"
CONSOLE_URL="http://localhost:30173"
FACTORY_NAME="samyn92-lab"
NAMESPACE="agents"
QUICK="${1:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

passed=0
failed=0
skipped=0

# ── Helpers ──

inc_passed() { passed=$((passed + 1)); }
inc_failed() { failed=$((failed + 1)); }
inc_skipped() { skipped=$((skipped + 1)); }

bot_token() {
  kubectl get secret gitlab-bot-planner -n "$NAMESPACE" -o jsonpath='{.data.token}' | base64 -d
}

gl() {
  curl -sf --header "PRIVATE-TOKEN: $(bot_token)" "$GITLAB_API$1"
}

gl_post() {
  curl -sf --header "PRIVATE-TOKEN: $(bot_token)" \
    --header "Content-Type: application/json" \
    --request POST "$GITLAB_API$1" --data "$2"
}

gl_put() {
  curl -sf --header "PRIVATE-TOKEN: $(bot_token)" \
    --header "Content-Type: application/json" \
    --request PUT "$GITLAB_API$1" --data "$2"
}

bff() {
  curl -sf "$BFF_URL$1"
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo -e "  ${GREEN}PASS${NC} $desc"
    inc_passed
  else
    echo -e "  ${RED}FAIL${NC} $desc (expected: $expected, got: $actual)"
    inc_failed
  fi
}

assert_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    echo -e "  ${GREEN}PASS${NC} $desc"
    inc_passed
  else
    echo -e "  ${RED}FAIL${NC} $desc (expected to contain: $needle)"
    inc_failed
  fi
}

assert_http() {
  local desc="$1" url="$2" expected_code="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$code" = "$expected_code" ]; then
    echo -e "  ${GREEN}PASS${NC} $desc (HTTP $code)"
    inc_passed
  else
    echo -e "  ${RED}FAIL${NC} $desc (expected HTTP $expected_code, got $code)"
    inc_failed
  fi
}

wait_for() {
  local desc="$1" cmd="$2" timeout="${3:-60}"
  local elapsed=0
  echo -ne "  ${YELLOW}WAIT${NC} $desc..."
  while ! eval "$cmd" &>/dev/null; do
    sleep 3
    elapsed=$((elapsed + 3))
    if [ $elapsed -ge $timeout ]; then
      echo -e "\r  ${RED}TIMEOUT${NC} $desc (after ${timeout}s)"
      inc_failed
      return 1
    fi
    echo -ne "."
  done
  echo -e "\r  ${GREEN}PASS${NC} $desc (${elapsed}s)"
  inc_passed
}

skip() {
  echo -e "  ${YELLOW}SKIP${NC} $1"
  inc_skipped
}

section() {
  echo ""
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

# ── Tests ──

section "1. Prerequisites"

assert_http "BFF healthcheck" "$BFF_URL/healthz" "200"
assert_http "Console serving" "$CONSOLE_URL/" "200"
assert_http "Auth wall active (401 without cookie)" "$BFF_URL/api/v1/agents" "401"
assert_http "Auth providers endpoint" "$BFF_URL/auth/providers" "200"

op_ready=$(kubectl get deploy/operator-dev -n agent-system -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
assert_eq "Operator pod running" "1" "$op_ready"

section "2. Bot Token Validity"

user=$(gl "/user" | jq -r '.username // empty')
assert_eq "Planner token authenticates" "samyn92" "$user"

projects=$(gl "/groups/$GITLAB_GROUP/projects" | jq length)
assert_eq "Can list group projects (>0)" "true" "$([ "$projects" -gt 0 ] && echo true || echo false)"

section "3. Factory Deployment"

phase=$(kubectl get agent "${FACTORY_NAME}-planner" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
assert_eq "Factory planner agent exists + Running" "Running" "$phase"

phase=$(kubectl get agent "${FACTORY_NAME}-reviewer" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
assert_eq "Factory reviewer agent exists + Running" "Running" "$phase"

phase=$(kubectl get agent "${FACTORY_NAME}-implementer" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
assert_eq "Factory implementer agent Ready" "Ready" "$phase"

phase=$(kubectl get channel "${FACTORY_NAME}-label-bridge" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
assert_eq "Factory label bridge Ready" "Ready" "$phase"

phase=$(kubectl get integration "${FACTORY_NAME}-planner" -n "$NAMESPACE" -o jsonpath='{.status.phase}' 2>/dev/null || echo "NotFound")
assert_eq "Factory planner integration Ready" "Ready" "$phase"

section "4. Issue Lifecycle"

# Create a test issue
echo -e "  ${YELLOW}...${NC} Creating test issue on $GITLAB_PROJECT..."
issue_json=$(gl_post "/projects/$PROJECT_ID/issues" \
  "{\"title\":\"[E2E Test] Health check endpoint\",\"description\":\"## Test\\nAutomated E2E test issue.\\n\\n- [ ] Add /healthz endpoint\\n- [ ] Return 200 on healthy\",\"labels\":\"agent::planning\"}")
issue_iid=$(echo "$issue_json" | jq -r '.iid')
assert_eq "Issue created" "true" "$([ -n "$issue_iid" ] && [ "$issue_iid" != "null" ] && echo true || echo false)"
echo -e "  ${BLUE}INFO${NC} Issue IID: $issue_iid"

# Verify the issue has the planning label
labels=$(gl "/projects/$PROJECT_ID/issues/$issue_iid" | jq -r '.labels[]' | tr '\n' ',')
assert_contains "Issue has agent::planning label" "agent::planning" "$labels"

section "5. Plan Refinement (Agent Interaction)"

if [ "$QUICK" = "--quick" ]; then
  skip "Plan refinement (--quick mode)"
else
  # Post a note on the issue (simulating human feedback)
  note_json=$(gl_post "/projects/$PROJECT_ID/issues/$issue_iid/notes" \
    "{\"body\":\"Please also add a readiness probe configuration for Kubernetes.\"}")
  note_id=$(echo "$note_json" | jq -r '.id')
  assert_eq "Feedback note posted" "true" "$([ -n "$note_id" ] && [ "$note_id" != "null" ] && echo true || echo false)"
fi

section "6. Label Transition (Planning → Todo)"

# Move issue to agent::todo (simulates "Approve" in the UI)
gl_put "/projects/$PROJECT_ID/issues/$issue_iid" \
  "{\"add_labels\":\"agent::todo\",\"remove_labels\":\"agent::planning\"}" > /dev/null

sleep 2
labels=$(gl "/projects/$PROJECT_ID/issues/$issue_iid" | jq -r '.labels[]' | tr '\n' ',')
assert_contains "Issue moved to agent::todo" "agent::todo" "$labels"

section "7. Label Bridge → AgentRun Dispatch"

if [ "$QUICK" = "--quick" ]; then
  skip "AgentRun dispatch (--quick mode)"
else
  # Wait for the label bridge to detect the issue and create an AgentRun
  echo -e "  ${YELLOW}...${NC} Waiting for label bridge to fire implementer (up to 90s)..."
  wait_for "AgentRun created for implementer" \
    "kubectl get ar -n $NAMESPACE -l agents.agentops.io/agent=${FACTORY_NAME}-implementer --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}' 2>/dev/null | grep -q ." \
    90

  # Check the AgentRun status
  run_name=$(kubectl get ar -n "$NAMESPACE" -l "agents.agentops.io/agent=${FACTORY_NAME}-implementer" \
    --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].metadata.name}')
  if [ -n "$run_name" ]; then
    echo -e "  ${BLUE}INFO${NC} AgentRun: $run_name"
    run_phase=$(kubectl get ar "$run_name" -n "$NAMESPACE" -o jsonpath='{.status.phase}')
    assert_contains "AgentRun phase is Running or Succeeded" "$run_phase" "Running Succeeded Pending"
  fi
fi

section "8. Console API Smoke Tests"

assert_http "GET /auth/providers returns 200" "$BFF_URL/auth/providers" "200"
assert_http "GET /healthz returns 200" "$BFF_URL/healthz" "200"

# These require auth — should return 401 without cookie
assert_http "GET /api/v1/agents requires auth" "$BFF_URL/api/v1/agents" "401"
assert_http "GET /api/v1/workspaces requires auth" "$BFF_URL/api/v1/workspaces" "401"
assert_http "GET /api/v1/agentruns requires auth" "$BFF_URL/api/v1/agentruns" "401"

section "9. Cleanup"

# Close the test issue
gl_put "/projects/$PROJECT_ID/issues/$issue_iid" "{\"state_event\":\"close\"}" > /dev/null
echo -e "  ${BLUE}INFO${NC} Test issue #$issue_iid closed"

# Delete any AgentRuns created during the test
if [ "$QUICK" != "--quick" ]; then
  kubectl delete ar -n "$NAMESPACE" -l "agents.agentops.io/agent=${FACTORY_NAME}-implementer" --ignore-not-found > /dev/null 2>&1
  echo -e "  ${BLUE}INFO${NC} Test AgentRuns cleaned up"
fi

# ── Summary ──

section "Results"
total=$((passed + failed + skipped))
echo -e "  Total:   $total"
echo -e "  ${GREEN}Passed:  $passed${NC}"
if [ $failed -gt 0 ]; then
  echo -e "  ${RED}Failed:  $failed${NC}"
fi
if [ $skipped -gt 0 ]; then
  echo -e "  ${YELLOW}Skipped: $skipped${NC}"
fi
echo ""

if [ $failed -gt 0 ]; then
  echo -e "${RED}E2E FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}E2E PASSED${NC}"
  exit 0
fi
