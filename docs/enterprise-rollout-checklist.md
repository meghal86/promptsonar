# PromptSonar Enterprise Pilot Rollout Checklist

Use this checklist for a 15-minute security-team pilot. The goal is to produce repeatable evidence without requiring a hosted PromptSonar account.

## 1. Install

```bash
npx @promptsonar/cli --version
```

Expected: prints the published CLI version.

## 2. Baseline Scan

```bash
npx @promptsonar/cli scan . --json --output promptsonar-results.json --fail-on high
```

Capture:

- Total findings by severity.
- Top 5 files by finding count.
- Any false positives.
- Whether the command is fast enough for PR checks.

## 3. MCP Audit

```bash
npx @promptsonar/cli audit-mcp --json --output promptsonar-mcp.json
```

Capture:

- Any `MCP-001` critical exposed endpoints.
- Any `MCP-005` hardcoded secrets.
- Any unknown remote domains requiring review.
- Whether Claude/Cursor/local configs were auto-discovered.

## 4. CI Trial

Copy one of:

- `examples/github-actions-promptsonar-sarif.yml`
- `examples/gitlab-ci-promptsonar.yml`
- `examples/pre-commit-promptsonar.yaml`

Capture:

- CI runtime.
- Whether SARIF or JSON artifacts are generated.
- Whether security reviewers can understand remediation text.

## 5. Pilot Feedback

Ask the pilot team:

- Would this catch issues before code review?
- Which rules are too noisy?
- Which missing rules would block adoption?
- Can we cite the team as a public or anonymized user?

## 6. Evidence Archive

Save screenshots and artifacts under `/evidence/` using date-prefixed filenames. Do not commit customer secrets or private source code.
