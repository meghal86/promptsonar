# PromptSonar MCP Security Preprint Draft

Target category: `cs.SE`

Working title:

> Local-First Static Auditing of Model Context Protocol Configurations for Agent Tool-Poisoning Risk

## Abstract Draft

Model Context Protocol (MCP) configurations increasingly define the trust boundary between AI agents, local tools, remote services, and developer workstations. Misconfigured MCP servers can expose agents to untrusted endpoints, excessive filesystem or shell capabilities, hardcoded secrets, and prompt-injection content embedded in tool descriptions. This paper presents PromptSonar MCP Audit, a local-first static analysis approach for detecting security risks in MCP configuration files without sending source code or prompts to an external model. We define seven deterministic rule classes covering unencrypted or exposed endpoints, over-broad tool scope, missing authentication indicators, suspicious prompt-like tool text, hardcoded secrets, unknown remote domains, and malformed legacy configuration shapes. We describe the scanner architecture, rule taxonomy, CI-friendly SARIF output, and an initial fixture benchmark for safe and vulnerable MCP configurations. The goal is to provide a practical baseline for AI agent supply-chain security and to support reproducible evaluation of MCP configuration risk before deployment.

## Proposed Outline

1. Introduction
2. Background: MCP and agent tool trust boundaries
3. Threat model
4. Rule taxonomy
5. PromptSonar MCP Audit implementation
6. Fixture benchmark and evaluation method
7. Limitations
8. Related work
9. Conclusion

## Benchmark and Evaluation Plan

The initial evaluation should use a versioned fixture corpus committed to the public repository. Each fixture should be labeled with expected findings so results are reproducible by reviewers, users, and security teams.

### Corpus Structure

```text
tests/fixtures/mcp/
  safe-mcp.json
  vulnerable-mcp.json
```

The current seed corpus contains:

| Fixture | Expected Status | Purpose |
|---|---|---|
| `safe-mcp.json` | `pass` | Scoped local command server with schema version and no broad permissions. |
| `vulnerable-mcp.json` | `fail` | Unencrypted raw-IP remote endpoint, broad admin/filesystem scope, prompt-injection text, and hardcoded API key. |

Before submission, expand this into at least 50 fixtures:

| Category | Target Count | Notes |
|---|---:|---|
| Safe local command configs | 10 | Scoped directory access, no secrets, no remote URL. |
| Safe authenticated remote configs | 10 | HTTPS endpoints with explicit auth indicators. |
| Unsafe endpoint configs | 8 | HTTP, localhost exposure, raw IPs, suspicious ports. |
| Over-broad scope configs | 8 | Shell, root/admin, all-files, unrestricted network language. |
| Tool-description poisoning configs | 6 | Prompt-injection phrases and zero-width obfuscation. |
| Hardcoded secret configs | 6 | API keys, Bearer tokens, GitHub tokens, Slack tokens. |
| Malformed or legacy configs | 2 | Invalid JSON or missing recognized server shape. |

### Metrics

Report deterministic scanner metrics:

- True positives: vulnerable fixtures with expected rule IDs detected.
- False negatives: vulnerable fixtures where expected rule IDs are missed.
- True negatives: safe fixtures with no findings.
- False positives: safe fixtures with unexpected findings.
- Rule-level precision and recall where labels are available.
- Runtime for single-file and corpus scans.

### Reproducible Commands

```bash
npm install
npm run build --workspaces --if-present
npm test --workspace packages/core
node packages/cli/dist/cli.js audit-mcp tests/fixtures/mcp/vulnerable-mcp.json --json
node packages/cli/dist/cli.js audit-mcp tests/fixtures/mcp/safe-mcp.json --json
tests/runner/test_mcp_audit_exit_codes.sh
```

### Baseline Results To Include

Current seed fixture behavior:

| Command | Expected Exit | Expected Result |
|---|---:|---|
| `audit-mcp tests/fixtures/mcp/safe-mcp.json` | `0` | No findings. |
| `audit-mcp tests/fixtures/mcp/vulnerable-mcp.json` | `3` | Includes `MCP-001`, `MCP-002`, `MCP-004`, `MCP-005`, `MCP-006`, and `MCP-007`. |

The evaluation should explicitly state that this is static configuration analysis. It does not prove runtime exploitability; it identifies risk indicators that should trigger review before an MCP server is trusted by an agent.

## Threat Model Notes

- Attacker controls or influences an MCP server package, URL, config snippet, or tool description.
- Developer installs or copies MCP config into Claude, Cursor, or another MCP-capable client.
- Agent may call tools with local filesystem, shell, network, or credential access.
- Static config review should catch obvious risk before runtime execution.

## Rule Taxonomy

- `MCP-001`: unencrypted, local, or raw-IP endpoint.
- `MCP-002`: over-broad filesystem, shell, admin, or network scope.
- `MCP-003`: remote server missing authentication indicators.
- `MCP-004`: suspicious tool description or prompt-injection text.
- `MCP-005`: hardcoded secrets in config.
- `MCP-006`: unknown remote domain requiring review.
- `MCP-007`: legacy or malformed config shape.

## Evidence To Add Before Submission

- Expanded benchmark corpus size and composition.
- False-positive/false-negative table.
- Comparison to manual review baseline.
- Links to public repository, npm package, and reproducible fixtures.
- arXiv URL after submission.
