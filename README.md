# PromptSonar

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/promptsonar-tools.promptsonar?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar)
[![GitHub stars](https://img.shields.io/github/stars/meghal-promptsonar/promptsonar?style=social)](https://github.com/meghal-promptsonar/promptsonar)

Static scanner for prompt injection (OWASP LLM01), API key leaks, and jailbreaks in code. Local, fast, no external LLM calls.

![CLI Scan Output](screenshot-cli-fail.png)

## 30-Second Demo

```bash
npx @promptsonar/cli scan .
npx @promptsonar/cli audit-mcp
```

PromptSonar audits AI prompts and MCP configs locally. It does not send code or prompts to an external LLM.

## Features
- **Auto-Detect Embedded Prompts**: Locates hardcoded LLM prompts in JavaScript, TypeScript, Python, Go, Java, Rust, c# and configuration files automatically.
- **Security Check (OWASP LLM01/LLM02)**: Instantly detects Prompt Injections, Developer Modes, role overrides, unicode/base64 obfuscation and exposes them.
- **MCP Config Auditing**: Finds unsafe MCP server URLs, missing auth indicators, broad tool scope, hardcoded secrets, and prompt-injection text in Claude/Cursor MCP configs.
- **CI/CD Gating**: Fails hard on Critical vulnerabilities to protect CI pipelines.
- **Live IDE Feedback**: Diagnostics live in your editor bridging directly into the exact same algorithmic rules engine powering the CLI.

![VS Code Hover](screenshot-vscode-squiggles.png)

## Install

### 1. VS Code Extension
Open VS Code → Extensions → Search "PromptSonar"

### 2. CLI Tool (Local Developer Usage)
```bash
npm install -g @promptsonar/cli@latest
promptsonar scan .
```

## VS Code Extension Features

Once the PromptSonar extension is installed, you can scan your code seamlessly from within the editor. 
**Note:** These commands are run from the VS Code **Command Palette**, NOT your terminal.

- **Run Health Check:** 
  You can click the `▶ Run PromptSonar Health Check` **CodeLens** that appears directly above any detected prompt, or use the play button in the Editor Title Menu.
- **Scan Entire Workspace:** 
  Open the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`), type **`PromptSonar: Scan Entire Workspace`**, and hit Enter. This will scan all supported files in your project and generate a master HTML security report.
- **Configuration:** 
  If you find the CodeLenses visually distracting while typing, you can disable them by searching for `promptsonar.enableCodeLens` in your VS Code settings.

## Running Scans (CLI Tool)
```bash
# Scan a specific file or directory
promptsonar scan tests/validation/ultimate_injection_test.js

# Output report as JSON to parse programmatically
promptsonar scan . --json > report.json
```

## Auditing MCP Configs

```bash
# Auto-discover Claude, Cursor, and local MCP config files
promptsonar audit-mcp

# Audit a specific config
promptsonar audit-mcp tests/fixtures/mcp/vulnerable-mcp.json

# Machine-readable output
promptsonar audit-mcp --json
promptsonar audit-mcp --sarif --output promptsonar-mcp.sarif
```

Rule coverage:
- `MCP-001`: unencrypted, local, or raw-IP server endpoint.
- `MCP-002`: over-broad filesystem, shell, admin, or network scope.
- `MCP-003`: remote server missing authentication indicators.
- `MCP-004`: suspicious tool description or prompt-injection text.
- `MCP-005`: hardcoded secrets in config.
- `MCP-006`: unknown remote domain requiring review.
- `MCP-007`: legacy or malformed config shape.

## Known Limitations - v1.0.28

**Static analysis constraints (shared by Snyk, SonarQube, ESLint):**

1. **Runtime-constructed prompts**
   Values fetched from a database or API at runtime cannot be statically analyzed.
   → PromptSonar Runtime SDK: Phase 4.

2. **Deep function indirection**
   `const getPrompt = () => JAILBREAK; usePrompt(getPrompt())`
   → Direct assignments and inline template literals only.

**Evasion checks covered by deterministic rules/tests:**
- Base64 encoded jailbreak strings are decoded before pattern matching.
- Cyrillic homoglyph substitution is normalized before pattern matching.
- Mathematical Unicode symbol ranges are flagged as obfuscation risk.
- Zero-width character injection is stripped before pattern matching.

Semantic drift detection is experimental and is not marketed as a production guarantee yet.
