#!/bin/bash
# Run once to create golden snapshots.
# Check these into git. They are the source of truth.

FILES=(
  "should_flag/c1_jailbreak_reset_basic.ts"
  "should_flag/c2_dan_classic.ts"
  "should_flag/c3_openai_key_in_prompt.ts"
  "should_flag/c4_ssn_in_prompt.ts"
  "should_flag/h1_act_as_no_constraints.ts"
  "should_not_flag/fp_imports_and_boilerplate.ts"
  "should_not_flag/fp_normal_business_logic.ts"
  "edge_cases/multi_prompt_same_file.ts"
  "edge_cases/string_length_boundary.ts"
)

mkdir -p golden/snapshots

for file in "${FILES[@]}"; do
  name=$(echo "$file" | tr '/' '_' | sed 's/\.ts$//')
  promptsonar scan "tests/validation/$file" --json > "golden/snapshots/${name}.json"
  echo "Snapshot created: ${name}.json"
done