# PromptSonar VS Code Extension

Inline prompt-security diagnostics for VS Code.

PromptSonar scans AI prompts and agent instructions locally while you work. It uses the same static rules as the CLI and makes zero LLM calls.

## Install

Install from the marketplace:

https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar

## Features

- Inline diagnostics for detected prompt risks.
- Workspace scan command from the Command Palette.
- Local static rules for prompt injection, Unicode evasion, secrets, structure, and clarity.
- Same rule family as `@promptsonar/cli`.

## CLI Pairing

```bash
npm install -g @promptsonar/cli
promptsonar scan .
```

Main documentation: https://github.com/meghal86/promptsonar
