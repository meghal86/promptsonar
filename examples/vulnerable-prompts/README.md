# Vulnerable Prompt Examples

These examples are intentionally unsafe. Use them to understand how PromptSonar rules fire and how to rewrite risky prompt or MCP config patterns.

Run:

```bash
npx @promptsonar/cli scan examples/vulnerable-prompts --json
```

MCP example:

```bash
npx @promptsonar/cli audit-mcp examples/vulnerable-prompts/unsafe-mcp-config.json
```
