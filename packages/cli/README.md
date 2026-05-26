# @promptsonar/cli

CLI for PromptSonar: local-first static security scanning for AI prompts, agent instructions, MCP configs, and CI workflows.

```bash
npm install -g @promptsonar/cli
promptsonar scan .
```

No install:

```bash
npx @promptsonar/cli scan .
```

## Commands

```bash
promptsonar scan . --json
promptsonar scan . --sarif --output promptsonar.sarif
promptsonar audit-mcp
promptsonar sbom ./src --output prompt-sbom.json
promptsonar demo
```

## Notes

- Zero LLM calls.
- Runs locally.
- Maps supported security findings to OWASP LLM Top 10.
- Static-analysis findings are signals and require review.

Main documentation: https://github.com/meghal86/promptsonar
