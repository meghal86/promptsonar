# PromptSonar

**Static security scanner for LLM prompt injection, jailbreaks, and MCP tool-poisoning.**

Built for developers who ship AI applications and need a pre-deploy security gate, not another runtime dashboard.

```bash
npx @promptsonar/cli scan ./src
npx @promptsonar/cli audit-mcp
```

[![PromptSonar](https://img.shields.io/badge/PromptSonar-Protected-brightgreen)](https://github.com/meghal86/promptsonar)
[![npm](https://img.shields.io/npm/v/@promptsonar/cli)](https://www.npmjs.com/package/@promptsonar/cli)
[![VS Code](https://img.shields.io/visual-studio-marketplace/i/promptsonar-tools.promptsonar)](https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar)

![PromptSonar playground showing a vulnerable prompt failing security checks](docs/assets/playground-faulty.png)

-----

## What It Catches

| Category | Rules | OWASP |
| --- | --- | --- |
| Prompt injection and jailbreaks | C1, C2 | LLM01 |
| Privilege escalation | C3 | LLM01 |
| PII and secret exposure | H2, H3 | LLM02 |
| Unicode evasion, homoglyphs, zero-width | E1, E2, E3 | LLM01 |
| Base64 encoded payloads | E1 | LLM01 |
| RAG and tool poisoning | R1, R2 | LLM07 |
| MCP server vulnerabilities | MCP-001-007 | Agentic Top 10 |

-----

## Install

```bash
# Scan prompt strings in source code
npx @promptsonar/cli scan ./src

# Audit MCP server configs
npx @promptsonar/cli audit-mcp

# Generate Prompt SBOM (CycloneDX v1.4)
npx @promptsonar/cli sbom ./src --output prompt-sbom.json

# Apply governance policy
npx @promptsonar/cli scan ./src --policy-file .promptsonar-policy.yaml
```

-----

## VS Code Extension

Install from the marketplace:
https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar

Inline diagnostics as you write prompts. Same rules as the CLI, running locally.

-----

## IDE Integration

PromptSonar runs where developers write prompts: VS Code, Claude Code, Cursor, CLI, and CI.

### Claude Code

Auto-scan prompts before execution. Zero LLM calls, zero telemetry.

See `.claude/skills/prompt-security/`.

### Cursor

Lint prompts during generation and block critical findings.

Copy `.cursor/rules/prompt-security.mdc` to your project.

-----

## GitHub Action

```yaml
- name: PromptSonar Security Scan
  uses: promptsonar/action@v1
  with:
    path: './src'
    fail-on: 'high'
    policy-file: '.promptsonar-policy.yaml'
```

Blocks PRs with critical findings. Uploads SARIF to GitHub Code Scanning.

-----

## Why Static Analysis?

Runtime interception tools screen prompts as they arrive at the model. Static analysis catches vulnerabilities in source code before they ship.

The two layers are complementary:

- Static: catches what is written in source code
- Runtime: catches what is assembled dynamically

PromptSonar is the static layer. It runs locally, adds zero latency to production, and catches vulnerabilities before any user sees them.

-----

## 7-Factor Standard

Every production prompt should pass these checks before deployment:

1. Instruction hierarchy
2. Input validation
3. Secret hygiene
4. Output constraints
5. Context isolation
6. Consistency
7. Auditability

See the integrated manifesto and evidence workflow in `research/repo-scan/`.

-----

## OWASP LLM Top 10 + Agentic Top 10 Coverage

| Risk Area | PromptSonar Coverage |
| --- | --- |
| LLM01 Prompt Injection | Direct injection, persona override, Base64 payloads, homoglyphs, zero-width characters |
| LLM02 Sensitive Information Disclosure | API keys, passwords, tokens, SSNs, credit cards, hardcoded credentials |
| LLM07 Insecure Plugin / Tool Design | RAG injection, unbounded access, MCP tool scope, MCP missing auth |
| Agentic Tool Poisoning | Suspicious MCP tool descriptions, unknown domains, over-broad filesystem and shell scope |
| Governance Evidence | SARIF v2.1.0, JSON, HTML reports, Prompt SBOM, policy checks |

-----

## Benchmark Results

We tested 100 prompt and MCP config fixtures. See `/benchmarks` for the full dataset.

False positive rates per rule:

- C1 (Prompt Injection): ~4%
- H1 (Unbounded Persona): ~8%
- E1/E2/E3 (Evasion): ~0%
- MCP-001-005: ~0-2%

-----

## Published Research

Article 1: Detecting Unicode Homoglyph and Zero-Width Character Evasion in LLM Prompt Injection Attacks

https://medium.com/@meghal86/detecting-unicode-homoglyph-and-zero-width-character-evasion-in-llm-prompt-injection-attacks-5b2df4d46989

Article 2: Static Analysis for LLM Prompt Security: A Methodology for Pre-Deploy Vulnerability Detection

https://dev.to/meghal_parikh_b8c5c6e3244/static-analysis-for-llm-prompt-security-a-methodology-for-pre-deploy-vulnerability-detection-48oc

-----

## Screenshots

![PromptSonar playground showing a clean prompt passing all pillars](docs/assets/playground-good.png)

![PromptSonar security report card showing a protected prompt score](docs/assets/report-card-clean.png)

-----

## License

MIT
