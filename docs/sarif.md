# SARIF And GitHub Security

PromptSonar can emit SARIF v2.1.0 so findings appear in GitHub Code Scanning and the repository Security tab.

## CLI Usage

```bash
promptsonar scan ./src --sarif --output promptsonar.sarif
```

The SARIF output includes:

- Stable rule IDs.
- Rule descriptions and remediation help.
- `helpUri` links to `docs/rules.md` anchors.
- Exact file, line, and column regions when available.
- Evidence snippets.
- Recommendation text in result messages.
- OWASP category in result properties when mapped.
- Confidence enum in result properties.
- Partial fingerprints for GitHub deduplication.

## Confidence vs. severity

`confidence` (and the rule-level `precision` derived from it) answers *how sure
PromptSonar is that a finding is real*. `level` / `severity` answers *how bad it
would be if real*. The two are independent: a critical finding produced by a
phrase match is reported with the confidence of that phrase match, not with the
confidence implied by its severity.

Confidence is derived only from how a rule detects its finding:

| Confidence | Detection method | Examples |
| --- | --- | --- |
| `HIGH` | Exact signature: specific characters, encodings, credential formats, structural MCP config checks | `sec_zero_width_injection`, `sec_homoglyph_evasion`, `sec_base64_encoded_payload`, `sec_owasp_llm02_pii`, `MCP-*` |
| `MEDIUM` | Phrase or keyword match | `sec_owasp_llm01_injection`, `sec_workflow_escalation`, `sec_privileged_sink_access`, `clarity_*` |
| `LOW` | Inferred from the absence of text in a prompt | `bp_missing_cot`, `bp_missing_persona`, `bp_missing_few_shot`, `struct_missing_format_enforcer` |

`VERY_HIGH` remains a valid value of the enum but is not produced from rule
evidence alone.

## GitHub Action Example

```yaml
name: PromptSonar

on:
  pull_request:
  push:
    branches: [main]

jobs:
  promptsonar:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install -g @promptsonar/cli
      - run: promptsonar scan ./src --sarif --output promptsonar.sarif --fail-on high
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: promptsonar.sarif
```

## Fail-On Examples

```bash
# Block only critical findings
promptsonar scan ./src --fail-on critical

# Block high and critical findings
promptsonar scan ./src --fail-on high

# Report only; never fail CI
promptsonar scan ./src --fail-on none
```

Suppressed findings do not count toward fail thresholds, but they remain visible in output for auditability.

## GitHub Security Tab Behavior

GitHub deduplicates alerts by SARIF rule ID, location, and partial fingerprints. PromptSonar includes a deterministic `promptsonarFinding` fingerprint derived from rule ID, file, region, and evidence text.

Static analysis findings are signals, not confirmed exploits or CVEs. Review each alert before treating it as a vulnerability disclosure.
