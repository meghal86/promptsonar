# Suppressions And Waivers

PromptSonar currently supports waiver files through the CLI:

```bash
promptsonar scan . --waiver .promptsonar.json
```

Waivers are intended for reviewed false positives, test fixtures, and intentionally vulnerable examples. They should be time-bounded and auditable.

## Current Status

Implemented:

- `--waiver <file>` CLI option.
- Active waiver loading in the scanner.
- Waived findings do not count toward CLI fail thresholds.

Planned:

- `.promptsonarignore` path-based ignore support.
- Inline ignore comments:
  - `promptsonar-ignore-next-line RULE_ID`
  - `promptsonar-ignore RULE_ID`

These planned forms are not claimed as implemented in the README.

## Recommended Waiver Practice

- Waive the narrowest rule possible.
- Include a reason and owner.
- Add an expiration date.
- Do not waive hardcoded secrets unless the value is demonstrably fake and safe.
- Prefer fixing prompt structure over suppressing security findings.
