# Vulnerable: unsafe MCP config

## Vulnerable config

See `unsafe-mcp-config.json`.

Expected findings:
- `MCP-001`
- `MCP-002`
- `MCP-004`
- `MCP-005`

## Fixed version

Use HTTPS, remove directive-like tool text, scope filesystem access to a specific safe directory, and load credentials from environment variables rather than committed config values.

## Explanation

MCP configs define tool trust boundaries for agent workflows. Insecure transport, broad scope, hardcoded secrets, and prompt-injection-like tool descriptions all increase agentic security risk.
