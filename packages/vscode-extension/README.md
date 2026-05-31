# PromptSonar VS Code Extension

Inline prompt-security diagnostics for VS Code.

PromptSonar scans AI prompts and agent instructions locally while you work. It uses the same static rules as the CLI and makes zero LLM calls.

## Install

Install from the marketplace:

https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar

## Features

- Inline diagnostics for detected prompt risks.
- Live diagnostics for `.prompt`, `.md`, `.txt`, `.json`, `.yaml`, `.yml`, agent instruction, system prompt, and MCP config files.
- PromptSonar Activity Bar workbench with Execution Path, Workflow Evidence, Confidence, Root Cause, Workflow Diff, and MCP risk sections.
- Command Palette actions: scan current file, open execution path, show workflow diff, export SARIF, copy report, copy execution path, and open playground.
- Deterministic quick fixes for wildcard permissions, `autoExecute`, hardcoded credentials, and untrusted user input patterns.
- Workspace scan command from the Command Palette.
- Local static rules for prompt injection, Unicode evasion, secrets, structure, and clarity.
- Same rule family as `@promptsonar/cli`.

## Manual Test

Run the extension locally:

```bash
npm install
npm run build --workspace packages/vscode-extension
code packages/vscode-extension
```

In VS Code, press `F5` to launch the Extension Development Host, then create `mcp.json`:

```json
{
  "mcpServers": {
    "shell": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/"],
      "autoExecute": true,
      "approvalRequired": false,
      "permissions": ["*"],
      "capabilities": ["shell", "filesystem", "network"]
    }
  }
}
```

Expected results:

- Problems panel shows PromptSonar MCP diagnostics while typing.
- PromptSonar Activity Bar shows the live execution path, evidence, confidence, root cause, and MCP risk.
- `PromptSonar: Show Workflow Diff` opens a Markdown diff report.
- `PromptSonar: Export SARIF` writes `promptsonar-vscode.sarif` next to the active file.
- Quick Fix offers deterministic safer rewrites where matching text exists.

## CLI Pairing

```bash
npm install -g @promptsonar/cli
promptsonar scan .
```

Main documentation: https://github.com/meghal86/promptsonar
