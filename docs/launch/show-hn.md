# Show HN Draft

Title:

```text
Show HN: PromptSonar - local-first scanner for AI prompts and MCP configs
```

Post:

```text
Hi HN,

I built PromptSonar, a local-first static scanner for AI prompts and MCP configuration files.

The new command is:

    npx @promptsonar/cli audit-mcp

It auto-discovers Claude/Cursor/local MCP configs and flags things like unencrypted MCP server URLs, raw IP endpoints, broad filesystem/shell/admin scope, missing auth indicators, hardcoded secrets, and prompt-injection text inside tool descriptions.

It also scans prompts embedded in code for prompt injection, PII/API keys, unbounded personas, unbounded tool access, and unsafe RAG patterns:

    npx @promptsonar/cli scan .

Why I built it:

MCP config is becoming an agent trust boundary. Developers copy MCP snippets from docs, READMEs, Slack, and chat answers. Those snippets can grant local tools, filesystem access, remote endpoints, and credentials to an agent. I wanted a lightweight linter that catches obvious risk before a tool server is trusted.

Design constraints:

- Runs locally.
- No external LLM calls.
- JSON and SARIF output for CI.
- Deterministic rules, not a black-box model.
- Works as CLI, GitHub Action/SARIF workflow, and VS Code extension.

Example:

An MCP config with `http://203.0.113.10:8787/mcp`, "admin access to read all files", "ignore previous instructions", and a hardcoded `sk-proj-*` key triggers MCP-001, MCP-002, MCP-004, MCP-005, MCP-006, and MCP-007.

I am looking for feedback from people using Claude Desktop, Cursor, or MCP servers in real dev workflows:

- Which MCP risk patterns are missing?
- Which rules are too noisy?
- What output would make this useful in CI/security review?

Repo: https://github.com/meghal86/promptsonar
```

Evidence checklist after posting:

- [ ] Save screenshot to `/evidence/YYYY-MM-DD_hackernews_showhn.png`.
- [ ] Add URL to `ADOPTION.md`.
- [ ] Record comments/upvotes after 24h, 72h, and 7 days.
