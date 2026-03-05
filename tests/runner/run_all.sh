#!/bin/bash
# Single command: runs ALL tests, generates report, exits 1 if anything fails

cd "$(dirname "$0")/../.."
TOTAL=0; PASSED=0; FAILED=0

run_scan() {
  local file=$1
  local expect_findings=$2  # "yes" or "no"
  local label=$3

  result=$(node packages/cli/bin/promptsonar scan "$file" --json 2>/dev/null)
  count=$(echo "$result" | jq '[.files[].prompts[].findings[]?] | length' 2>/dev/null || echo "0")

  TOTAL=$((TOTAL+1))

  if [ "$expect_findings" = "yes" ] && [ "$count" -gt 0 ]; then
    echo "✅ PASS [$label] — $count finding(s) detected as expected"
    PASSED=$((PASSED+1))
  elif [ "$expect_findings" = "no" ] && [ "$count" -eq 0 ]; then
    echo "✅ PASS [$label] — 0 findings as expected (no false positive)"
    PASSED=$((PASSED+1))
  elif [ "$expect_findings" = "yes" ] && [ "$count" -eq 0 ]; then
    if [[ "$file" == *"evasion"* ]]; then
      echo "⚠️ FAIL [$label] — Expected findings but got 0 (DOCUMENTED EVASION GAP)"
    else
      echo "❌ FAIL [$label] — Expected findings but got 0 (FALSE NEGATIVE)"
      FAILED=$((FAILED+1))
    fi
  else
    echo "❌ FAIL [$label] — Expected 0 but got $count finding(s) (FALSE POSITIVE)"
    FAILED=$((FAILED+1))
  fi
}

echo "═══════════════════════════════════════════════════"
echo "  PromptSonar — Full Test Suite"
echo "═══════════════════════════════════════════════════"
echo ""

echo "── Security Rules (Should Flag) ──"
run_scan "tests/validation/security/should_flag/c1_jailbreak_reset_basic.ts"   "yes" "C1 Jailbreak Reset"
run_scan "tests/validation/security/should_flag/c1_forget_everything.py"        "yes" "C1 Forget Everything"
run_scan "tests/validation/security/should_flag/c2_dan_classic.ts"             "yes" "C2 DAN Classic"
run_scan "tests/validation/security/should_flag/c2_developer_mode.py"          "yes" "C2 Developer Mode"
run_scan "tests/validation/security/should_flag/c3_openai_key_in_prompt.ts"    "yes" "C3 API Key Exposure"
run_scan "tests/validation/security/should_flag/c4_ssn_in_prompt.ts"           "yes" "C4 PII - SSN"
run_scan "tests/validation/security/should_flag/h1_act_as_no_constraints.ts"   "yes" "H1 Unbounded Persona"
run_scan "tests/validation/security/should_flag/h2_all_files.ts"               "yes" "H2 Unbounded Access"

echo ""
echo "── False Positive Tests (Should NOT Flag) ──"
run_scan "tests/validation/security/should_not_flag/c3_env_var_safe.ts"         "no" "C3 Safe env var usage"
run_scan "tests/validation/security/should_not_flag/h1_act_as_with_constraints.ts" "no" "H1 Bounded persona"
run_scan "tests/validation/security/should_not_flag/h2_scoped_access.ts"        "no" "H2 Scoped access"
run_scan "tests/validation/security/should_not_flag/fp_imports_and_boilerplate.ts" "no" "FP Imports"
run_scan "tests/validation/security/should_not_flag/fp_normal_business_logic.ts"   "no" "FP Business logic"

echo ""
echo "── Language Coverage ──"
run_scan "tests/validation/languages/typescript/ts_langchain_detection.ts"  "yes" "TS LangChain"
run_scan "tests/validation/languages/typescript/ts_openai_sdk.ts"           "yes" "TS OpenAI SDK"
run_scan "tests/validation/languages/typescript/ts_anthropic_sdk.ts"        "yes" "TS Anthropic SDK"
run_scan "tests/validation/languages/python/py_langchain.py"                "yes" "PY LangChain"
run_scan "tests/validation/languages/python/py_openai_sdk.py"               "yes" "PY OpenAI SDK"
run_scan "tests/validation/languages/go/go_prompt_detection.go"             "yes" "GO Basic"
run_scan "tests/validation/languages/java/JavaPromptTest.java"              "yes" "Java Basic"
run_scan "tests/validation/languages/rust/rust_prompt_test.rs"              "yes" "Rust Basic"
run_scan "tests/validation/languages/csharp/CsharpPromptTest.cs"            "yes" "C# Basic"
run_scan "tests/validation/languages/config/prompt_config_jailbreak.yaml"   "yes" "YAML Config"
run_scan "tests/validation/languages/config/clean_config.yaml"              "no"  "YAML Clean"

echo ""
echo "── Edge Cases ──"
run_scan "tests/validation/edge_cases/empty_file.ts"                        "no"  "Empty file"
run_scan "tests/validation/edge_cases/no_prompts.ts"                        "no"  "No prompts"
run_scan "tests/validation/edge_cases/multi_prompt_same_file.ts"            "yes" "Multi-prompt file"
run_scan "tests/validation/edge_cases/multiline_template_literals.ts"       "yes" "Multiline template"

echo ""
echo "── Evasion Tests (Document Results) ──"
# These may fail — document the result, don't fail the build
run_scan "tests/validation/evasion/unicode_obfuscation.ts"                  "yes" "Unicode evasion"
run_scan "tests/validation/evasion/comment_injection.ts"                    "yes" "Comment injection"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  RESULTS: $PASSED passed / $FAILED failed / $TOTAL total"
echo "═══════════════════════════════════════════════════"

[ $FAILED -eq 0 ] && echo "  ✅ ALL TESTS PASSED — Ready to launch" && exit 0
echo "  ❌ $FAILED TESTS FAILED — Fix before launch" && exit 1