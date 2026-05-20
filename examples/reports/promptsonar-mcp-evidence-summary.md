# PromptSonar MCP Evidence Report - Sample

Generated from:

```bash
node packages/cli/dist/cli.js audit-mcp tests/fixtures/mcp/vulnerable-mcp.json --json --output examples/reports/promptsonar-mcp-sample.json
node packages/cli/dist/cli.js audit-mcp tests/fixtures/mcp/vulnerable-mcp.json --sarif --output examples/reports/promptsonar-mcp-sample.sarif
```

## Summary

| Field | Value |
|---|---|
| Fixture | `tests/fixtures/mcp/vulnerable-mcp.json` |
| Status | `fail` |
| Expected Exit Code | `3` |
| Findings | `6` |
| Output Formats | JSON, SARIF |

## Findings

| Rule | Severity | Evidence |
|---|---|---|
| `MCP-001` | Critical | Unencrypted raw-IP MCP endpoint. |
| `MCP-002` | High | Broad admin/filesystem scope language. |
| `MCP-004` | Medium | Prompt-injection phrase in tool description. |
| `MCP-005` | High | Hardcoded OpenAI-style API key. |
| `MCP-006` | Medium | Unknown remote domain requiring review. |
| `MCP-007` | Low | Missing `schemaVersion` or `version`. |

## Enterprise Use

This report can be attached to a CI build, GitHub Security SARIF upload, or design-partner pilot summary. It is intentionally generated from a synthetic fixture and does not contain customer source code or secrets.
