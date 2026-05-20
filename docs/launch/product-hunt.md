# Product Hunt Launch Draft

## Tagline Options

- Local security scanner for AI prompts and MCP configs
- Find prompt injection and risky MCP servers locally
- Static analysis for agent prompts and MCP tool configs

## Short Description

PromptSonar is a local-first scanner for AI prompts, MCP configs, and agent tool-poisoning risks. It finds prompt injection, hardcoded secrets, unsafe tool scope, and risky MCP servers without sending code to an external LLM.

## Maker Comment

```text
I built PromptSonar because agent tooling is moving faster than the security review process around it.

Developers now copy MCP server configs into Claude, Cursor, and local repos. Those configs can define remote endpoints, local commands, filesystem access, credentials, and tool descriptions that are exposed to the model.

PromptSonar gives developers a local-first way to scan before trusting those configs:

    npx @promptsonar/cli audit-mcp

It also scans embedded prompts in code:

    npx @promptsonar/cli scan .

The tool is intentionally deterministic and local. No prompts or source code are sent to an external LLM. It supports JSON/SARIF output for CI and GitHub Security workflows.

I would especially value feedback from AI security engineers, agent builders, and teams using MCP in production-like workflows.
```

## Gallery Checklist

- [ ] Terminal screenshot of `audit-mcp` finding `MCP-001`.
- [ ] Terminal screenshot of clean `safe-mcp.json`.
- [ ] GitHub SARIF/security screenshot.
- [ ] VS Code extension screenshot.
- [ ] Architecture graphic: code/config -> local scanner -> JSON/SARIF/IDE.

## Evidence Checklist After Launch

- [ ] Save Product Hunt page screenshot to `/evidence/YYYY-MM-DD_producthunt_launch.png`.
- [ ] Save ranking/upvote screenshot after 24h.
- [ ] Add URL and screenshot status to `ADOPTION.md`.
