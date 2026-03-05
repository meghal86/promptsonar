#!/bin/bash
# Run in CI to detect regressions

FAIL=0

for snapshot in golden/snapshots/*.json; do
  name=$(basename "$snapshot" .json)
  file=$(echo "$name" | tr '_' '/')
  # Convert back to file path — adjust this logic to match your naming
  actual=$(promptsonar scan "tests/validation/${file}.ts" --json 2>/dev/null)

  if diff <(cat "$snapshot" | jq -S .) <(echo "$actual" | jq -S .) > /dev/null 2>&1; then
    echo "✅ PASS: $name"
  else
    echo "❌ FAIL: $name — output changed"
    diff <(cat "$snapshot" | jq -S .) <(echo "$actual" | jq -S .)
    FAIL=$((FAIL+1))
  fi
done

[ $FAIL -eq 0 ] && echo "All golden tests passed." && exit 0
echo "$FAIL golden tests FAILED." && exit 1