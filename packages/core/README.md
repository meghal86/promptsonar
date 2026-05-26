# @promptsonar/core

Core static-analysis engine for PromptSonar.

This package contains prompt parsing, rule evaluation, SARIF formatting, governance helpers, SBOM generation, MCP auditing, and benchmarkable rule logic used by the CLI, VS Code extension, and dashboard.

## Scope

- Prompt injection and jailbreak patterns.
- Unicode, homoglyph, zero-width, and Base64 evasion.
- Secret and PII-like prompt exposure.
- Prompt clarity, structure, consistency, best-practice, ethics, and efficiency checks.
- MCP config audit primitives.

## Usage

Most users should install the CLI:

```bash
npm install -g @promptsonar/cli
promptsonar scan .
```

Main documentation: https://github.com/meghal86/promptsonar
