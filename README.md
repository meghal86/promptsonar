# PromptSonar

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/promptsonar-tools.promptsonar?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar)
[![npm](https://img.shields.io/npm/v/@promptsonar/cli?label=npm%20CLI)](https://www.npmjs.com/package/@promptsonar/cli)
[![GitHub stars](https://img.shields.io/github/stars/meghal86/promptsonar?style=social)](https://github.com/meghal86/promptsonar)

**PromptSonar is a local-first static security scanner for AI prompts, MCP configs, and prompt governance evidence.**

It catches prompt injection, jailbreak text, hardcoded secrets, risky MCP servers, unsafe tool scope, and prompt-quality regressions before they reach production. No external LLM calls are required for the core scan path.

![PromptSonar playground showing a clean prompt passing all pillars](docs/assets/playground-good.png)

## Why PromptSonar

Most AI testing tools focus on runtime model evaluation. PromptSonar is different: it scans prompts-as-code and MCP configuration before merge, inside the CLI, CI, and VS Code.

| Use case | PromptSonar |
| --- | --- |
| Prompt injection in source code | Detects OWASP LLM01 patterns, role overrides, jailbreak phrases, and instruction hierarchy violations. |
| Secret leakage in prompts | Flags API keys, credentials, passwords, credit cards, SSNs, and sensitive hardcoded values. |
| MCP security review | Audits unsafe endpoints, missing auth indicators, over-broad filesystem/shell scope, suspicious tool descriptions, and hardcoded secrets. |
| Developer workflow | Runs locally from VS Code, CLI, CI, JSON, Markdown, and SARIF output. |
| Governance evidence | Produces auditable reports for waivers, policies, risk review, and release gates. |

## 30-Second Start

```bash
# Scan the current repo
npx @promptsonar/cli scan .

# Audit MCP configs discovered on the machine
npx @promptsonar/cli audit-mcp

# Emit SARIF for GitHub code scanning or CI
npx @promptsonar/cli scan . --sarif --output promptsonar.sarif
```

PromptSonar scans locally. Your prompts and source code are not sent to an external LLM by the deterministic rules engine.

## Install

### VS Code

Open VS Code, go to Extensions, and search for **PromptSonar**.

Command Palette commands:

- `PromptSonar: Scan Entire Workspace`
- `PromptSonar: Run Health Check`
- `PromptSonar: Export Report`

Important: VS Code commands run from the **Command Palette**, not from your terminal. If you type `PromptSonar: Scan Workspace` in `zsh`, the shell will correctly say `command not found`.

### CLI

```bash
npm install -g @promptsonar/cli@latest
promptsonar scan .
promptsonar audit-mcp
```

## Product Screenshots

### Playground: vulnerable prompt fails

The playground makes the value visible immediately: the vulnerable sample fails with injection and exposure signals, while the same UI shows attack paths, timeline events, and remediation guidance.

![PromptSonar playground showing a vulnerable prompt failing security checks](docs/assets/playground-faulty.png)

### Prompt Security Report Card

Turn a scan into a shareable report card with score, OWASP labels, jailbreak verdict, before/after hardening, and a GitHub badge.

![PromptSonar security report card showing a protected prompt score](docs/assets/report-card.png)

### VS Code Marketplace

PromptSonar ships as a VS Code extension for local editor feedback and whole-workspace scans.

![PromptSonar VS Code Marketplace listing](docs/assets/vscode-marketplace.png)

### npm CLI

The CLI can run locally, in CI, or as a SARIF-producing release gate.

![PromptSonar npm package listing](docs/assets/npm-package.png)

## What It Catches

| Category | Examples |
| --- | --- |
| Security | Prompt injection, jailbreak text, role override phrases, unsafe instruction hierarchy, hardcoded secrets, sensitive data exposure. |
| MCP risk | Raw IP or local endpoints, HTTP transport, missing auth indicators, broad filesystem/shell/admin/network scope, suspicious tool descriptions. |
| Obfuscation | Base64 jailbreaks, Unicode homoglyphs, zero-width characters, mathematical Unicode symbols, suspicious mixed-script payloads. |
| Prompt quality | Missing output contract, vague wording, missing quantifiers, contradiction, excessive token bloat, missing examples. |
| Governance | JSON, Markdown, and SARIF output for CI gates, review packets, and policy evidence. |

## MCP Security Wedge

PromptSonar includes a dedicated MCP audit path:

```bash
# Auto-discover Claude, Cursor, and local MCP config files
promptsonar audit-mcp

# Audit a specific config file
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

Reproducible benchmark:

```bash
npm run benchmark:mcp
```

The benchmark fixtures live under `benchmarks/mcp/` and produce JSON/Markdown summaries under `benchmarks/mcp/results/`.

## CI Example

```bash
npx @promptsonar/cli scan . --sarif --output promptsonar.sarif
npx @promptsonar/cli audit-mcp --sarif --output promptsonar-mcp.sarif
```

Recommended release gate:

- Fail on `critical` findings.
- Review `high` findings before merge.
- Require a documented waiver for accepted MCP risk.
- Upload SARIF to GitHub code scanning when running in CI.

## Local Development

```bash
npm install
npm run build
npm run smoke:features
npm run release:hygiene
```

Dashboard playground:

```bash
npm run dev --workspace packages/dashboard
open http://localhost:3000/playground
```

VS Code extension package:

```bash
npm run package --workspace packages/vscode-extension
```

## Known Limits

PromptSonar is static analysis. Like ESLint, Snyk, and Semgrep, it is strongest when prompts and MCP configs are visible in source, templates, or config files.

- Runtime-constructed prompts fetched only from a database or external API cannot be fully inspected statically.
- Deep function indirection can reduce precision when prompt text is assembled across many runtime branches.
- Semantic drift detection is experimental and should not be treated as a production guarantee yet.

## License

MIT
