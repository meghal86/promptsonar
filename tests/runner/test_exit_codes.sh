#!/bin/bash
# Tests that CLI exit codes match the spec

PASS=0
FAIL=0

check() {
  local desc=$1
  local expected=$2
  local actual=$3
  if [ "$actual" -eq "$expected" ]; then
    echo "✅ PASS: $desc (exit $actual)"
    PASS=$((PASS+1))
  else
    echo "❌ FAIL: $desc (expected $expected, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

# Exit code 0: clean file
promptsonar scan should_not_flag/fp_imports_and_boilerplate.ts > /dev/null 2>&1
check "Clean file → exit 0" 0 $?

# Exit code 1: critical finding
promptsonar scan should_flag/c1_jailbreak_reset_basic.ts > /dev/null 2>&1
check "Critical finding → exit 1" 1 $?

# Exit code 2: high finding (no critical)
promptsonar scan should_flag/h1_act_as_no_constraints.ts > /dev/null 2>&1
check "High finding → exit 2" 2 $?

# --fail-on=high: high triggers exit 1
promptsonar scan should_flag/h1_act_as_no_constraints.ts --fail-on=high > /dev/null 2>&1
check "--fail-on=high with high finding → exit 1" 1 $?

# --fail-on=critical with only high: should exit 0
promptsonar scan should_flag/h1_act_as_no_constraints.ts --fail-on=critical > /dev/null 2>&1
check "--fail-on=critical with only high finding → exit 0" 0 $?

echo ""
echo "Results: $PASS passed / $FAIL failed"
[ $FAIL -eq 0 ] && exit 0 || exit 1