# MCP Audit Benchmark

This benchmark is a small, deterministic fixture suite for validating `promptsonar audit-mcp` before launch posts, arXiv updates, and enterprise demos.

Run it from the repository root:

```bash
npm run benchmark:mcp
```

The runner builds `@promptsonar/core` and `@promptsonar/cli`, audits every fixture, compares detected rule IDs to `expected-rules.json`, and writes timestamped JSON/Markdown summaries under `benchmarks/mcp/results/`.

## Fixture Coverage

| Fixture | Expected Coverage |
|---|---|
| `safe-local-scoped.json` | Clean local command with scoped read-only path. |
| `safe-authenticated-remote.json` | HTTPS remote endpoint with explicit auth indicator. |
| `unsafe-raw-http-ip.json` | Unencrypted raw-IP endpoint, missing auth, unknown domain, missing schema version. |
| `unsafe-broad-scope.json` | Broad filesystem/admin/shell scope language. |
| `unsafe-tool-poisoning.json` | Prompt-injection text in tool description. |
| `unsafe-hardcoded-secret.json` | Hardcoded OpenAI-style secret in headers. |
| `unsafe-broad-write.json` | Broad write/delete filesystem access with unsafe scope. |
| `unsafe-host-env.json` | Sensitive host credentials or sockets passed into an MCP server. |
| `unsafe-unpinned-package.json` | Mutable or unpinned package execution in MCP server startup. |

## Evidence Use

Use the generated Markdown summary as a reproducible evidence artifact. It is not a large academic benchmark yet; it is a launch-grade smoke benchmark that proves the public CLI detects the advertised MCP rule classes.
