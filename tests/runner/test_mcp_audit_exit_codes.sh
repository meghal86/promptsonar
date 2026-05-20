#!/bin/bash
# Tests that audit-mcp CLI exit codes match the public CI contract.

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"

PASS=0
FAIL=0

check() {
  local desc=$1
  local expected=$2
  local actual=$3

  if [ "$actual" -eq "$expected" ]; then
    echo "PASS: $desc (exit $actual)"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc (expected $expected, got $actual)"
    FAIL=$((FAIL + 1))
  fi
}

node "$CLI" audit-mcp "$ROOT/tests/fixtures/mcp/safe-mcp.json" > /dev/null 2>&1
check "safe MCP config exits 0" 0 $?

node "$CLI" audit-mcp "$ROOT/tests/fixtures/mcp/vulnerable-mcp.json" > /dev/null 2>&1
check "critical MCP config exits 3" 3 $?

node "$CLI" audit-mcp "$ROOT/tests/fixtures/mcp/vulnerable-mcp.json" --json > /tmp/promptsonar-mcp-test.json 2>/dev/null
check "critical MCP config JSON exits 3" 3 $?

node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync('/tmp/promptsonar-mcp-test.json','utf8')); if (!data[0].findings.some(f=>f.rule_id==='MCP-001')) process.exit(1);"
check "JSON output includes MCP-001" 0 $?

rm -f /tmp/promptsonar-mcp-test.json

echo ""
echo "Results: $PASS passed / $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
