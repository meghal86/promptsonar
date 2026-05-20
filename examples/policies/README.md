# PromptSonar Policy Examples

These examples are review templates for teams adopting PromptSonar in CI. They are not yet enforced by `audit-mcp`; use them as organization policy documents beside the JSON/SARIF output.

## MCP Baseline

`promptsonar-mcp-policy.json` defines a practical enterprise baseline:

- Block `critical` and `high` MCP findings.
- Require human review for `medium` findings.
- Log `low` findings for migration hygiene.
- Capture reviewer rationale for accepted risk.

Suggested workflow:

```bash
npx @promptsonar/cli audit-mcp --json --output promptsonar-mcp.json
```

Attach `promptsonar-mcp.json`, `promptsonar-mcp-policy.json`, and reviewer approval notes to the security review ticket.
