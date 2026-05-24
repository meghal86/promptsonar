# Newsletter / Media Pitch

Subject options:

- Open-source MCP security scanner for Claude/Cursor configs
- PromptSonar: local-first scanner for AI prompts and MCP tool configs
- MCP config is becoming an agent supply-chain risk

Pitch:

```text
Hi {name},

I am building PromptSonar, an open-source local-first scanner for AI prompts and MCP configuration files.

The newest feature audits Claude/Cursor/local MCP configs:

    npx @promptsonar/cli audit-mcp

It flags unencrypted MCP server endpoints, raw IPs, broad filesystem/shell/admin scope, missing auth indicators, hardcoded secrets, unknown remote domains, and prompt-injection text in tool descriptions.

Why this may be interesting for your audience:

MCP configs are becoming a practical trust boundary for AI agents. Developers copy MCP snippets from READMEs, chats, and internal docs, but those snippets can grant local tools, credentials, and filesystem access to an agent. PromptSonar catches obvious risk locally before the config is trusted.

The tool also scans prompts embedded in code and outputs JSON/SARIF for CI.

Repo: https://github.com/meghal86/promptsonar
Demo commands:

    npx @promptsonar/cli audit-mcp
    npx @promptsonar/cli scan .

If useful, I can share a short technical writeup or provide a synthetic vulnerable MCP config example showing the findings.

Thanks,
Meghal
```

Tracking:

| Outlet | Contact | Sent Date | Reply | Mention URL | Screenshot Saved? |
|---|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD | No |
