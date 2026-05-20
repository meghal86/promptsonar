# OWASP GenAI / MCP Community Submission Draft

## Proposed Title

MCP Config Static Analysis Rules for Agent Supply-Chain Review

## Short Summary

PromptSonar adds a deterministic local scanner for MCP configuration files used by Claude Desktop, Cursor, and repository-local agent tooling. The scanner flags common trust-boundary risks before a developer or team trusts a copied MCP config.

## Proposed Contribution

Contribute a practical rule taxonomy and reproducible fixtures for MCP configuration review:

| Rule | Risk Class | Suggested OWASP Mapping |
|---|---|---|
| `MCP-001` | Unencrypted, local, or raw-IP endpoint | Supply-chain and insecure plugin/tool configuration risk |
| `MCP-002` | Over-broad filesystem, shell, admin, or network scope | Excessive agency / over-permissioned tool use |
| `MCP-003` | Remote server missing auth indicators | Insecure plugin design / weak access control |
| `MCP-004` | Tool-description prompt injection | Prompt injection / tool poisoning |
| `MCP-005` | Hardcoded secrets | Sensitive information disclosure |
| `MCP-006` | Unknown remote domain | Third-party dependency and provenance review |
| `MCP-007` | Legacy or malformed config shape | Governance and auditability gap |

## Why It Matters

MCP configs are often copied from READMEs, chats, internal docs, and examples. Those configs can grant an AI agent local tools, remote services, filesystem scope, and credentials. This makes MCP config a practical supply-chain input. Static review is a low-friction first layer before runtime enforcement.

## Reproducible Evidence

Repository:

```text
https://github.com/meghal86/promptsonar
```

Command:

```bash
npx @promptsonar/cli audit-mcp
```

Benchmark:

```bash
npm run benchmark:mcp
```

Baseline result:

```text
6 synthetic MCP fixtures passed / 0 failed
```

Fixture path:

```text
benchmarks/mcp/fixtures/
```

Evidence summary:

```text
benchmarks/mcp/results/2026-05-20-mcp-benchmark.md
```

## Proposed Ask

I would like feedback from the OWASP GenAI/MCP community on:

- Whether these rule classes align with emerging MCP risk categories.
- Which MCP-specific risks are missing from the taxonomy.
- Whether the fixtures are useful as seed examples for broader community test cases.
- Whether PromptSonar findings can be referenced as implementation examples for MCP config review guidance.

## Contact / Follow-Up

Maintainer: Meghal Parikh  
Project: PromptSonar  
GitHub: `https://github.com/meghal86/promptsonar`

