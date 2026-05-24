# PromptSonar MCP Benchmark Summary

Generated: 2026-05-21T20:58:51.298Z

Fixtures: 6
Passed: 6
Failed: 0

| Fixture | Expected Rules | Actual Rules | Exit Code | Status |
|---|---|---|---:|---|
| `safe-authenticated-remote.json` | none | none | 0 | PASS |
| `safe-local-scoped.json` | none | none | 0 | PASS |
| `unsafe-broad-scope.json` | `MCP-002` | `MCP-002` | 2 | PASS |
| `unsafe-hardcoded-secret.json` | `MCP-005` | `MCP-005` | 2 | PASS |
| `unsafe-raw-http-ip.json` | `MCP-001`, `MCP-003`, `MCP-006`, `MCP-007` | `MCP-001`, `MCP-003`, `MCP-006`, `MCP-007` | 3 | PASS |
| `unsafe-tool-poisoning.json` | `MCP-004` | `MCP-004` | 1 | PASS |

## Interpretation

This benchmark verifies advertised MCP rule classes against synthetic safe and vulnerable configs. It is intended as launch evidence and regression coverage, not a substitute for a large real-world corpus.
