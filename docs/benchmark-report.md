# PromptSonar Public Repository Benchmark Report

Generated: 2026-05-27T00:41:57.420Z

## Scope

PromptSonar scanned 20 public AI/agent repositories from GitHub using the local CLI. Repositories were cloned shallowly into a temporary directory, scanned locally, summarized, and then deleted. No third-party source code is committed in this repository.

The benchmark includes prompt scanning and MCP config auditing where candidate MCP config files were found.

Repository names are included for reproducibility. A finding in this report is not an assertion that a project is exploitable or that maintainers shipped a confirmed vulnerability.

## Methodology

- Scanner: local `packages/cli/dist/cli.js` from this repository.
- Prompt scan command: `promptsonar scan <candidate-file> --json --fail-on none`.
- Prompt candidates: files up to depth 5 whose names include prompt, agent, skill, or system, limited to the first 200 candidates per repo.
- MCP audit command: `promptsonar audit-mcp <candidate> --json`.
- Candidate MCP files: `mcp.json`, `.cursor/mcp.json`, `claude_desktop_config.json`, and `*mcp*.json` up to depth 4.
- Findings are static-analysis signals, not confirmed exploits, CVEs, or maintainer-verified vulnerabilities.
- Default PromptSonar ignores for docs/tests/build artifacts were active.

## Results Summary

- Repositories attempted: 20
- Repositories cloned successfully: 20
- Prompt candidate files scanned: 465
- Repositories with prompt findings: 15
- Repositories with high/critical prompt signals: 12
- MCP config candidates parsed: 8
- Repositories with MCP findings: 4
- Repositories with high/critical MCP signals: 3

## Repository-Level Summary

| Repository | Status | Prompt Findings | Prompt High/Critical | MCP Configs | MCP Findings | Rule Examples |
|---|---|---:|---:|---:|---:|---|
| `modelcontextprotocol/typescript-sdk` | scanned | 0 | 0 | 0 | 0 | none |
| `modelcontextprotocol/python-sdk` | scanned | 7 | 1 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_vague_words`, `eff_compression_potential`, `sec_unicode_injection_obfuscation` |
| `modelcontextprotocol/inspector` | scanned | 0 | 0 | 1 | 3 | `MCP-003`, `MCP-006`, `MCP-007` |
| `modelcontextprotocol/servers` | scanned | 0 | 0 | 1 | 3 | `MCP-003`, `MCP-006`, `MCP-007` |
| `upstash/context7` | scanned | 69 | 1 | 3 | 7 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_vague_words`, `eff_compression_potential`, `sec_unicode_injection_obfuscation`, `struct_missing_format_enforcer` |
| `browser-use/browser-use` | scanned | 140 | 15 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_vague_words`, `eff_compression_potential`, `eff_token_bloat`, `eff_token_budget` |
| `gpt-engineer-org/gpt-engineer` | scanned | 39 | 0 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `eff_compression_potential`, `struct_missing_format_enforcer` |
| `FlowiseAI/Flowise` | scanned | 302 | 2 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_vague_words`, `consist_contradiction`, `eff_compression_potential`, `sec_owasp_llm02_pii` |
| `mendableai/firecrawl` | scanned | 0 | 0 | 0 | 0 | none |
| `langfuse/langfuse` | scanned | 207 | 19 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_open_ended`, `clarity_vague_words`, `consist_contradiction`, `eff_compression_potential` |
| `mem0ai/mem0` | scanned | 286 | 23 | 3 | 6 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_open_ended`, `clarity_vague_words`, `eff_compression_potential`, `eff_token_bloat` |
| `deepset-ai/haystack` | scanned | 390 | 1 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_open_ended`, `clarity_vague_words`, `eff_compression_potential`, `sec_owasp_llm02_pii` |
| `guardrails-ai/guardrails` | scanned | 17 | 0 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `struct_missing_format_enforcer` |
| `microsoft/PromptWizard` | scanned | 145 | 1 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_vague_words`, `eff_compression_potential`, `eff_token_bloat`, `struct_missing_format_enforcer` |
| `instructor-ai/instructor` | scanned | 36 | 2 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_vague_words`, `eff_compression_potential`, `sec_owasp_llm02_pii`, `sec_unicode_injection_obfuscation` |
| `yoheinakajima/babyagi` | scanned | 12 | 0 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `struct_missing_format_enforcer` |
| `microsoft/JARVIS` | scanned | 0 | 0 | 0 | 0 | none |
| `TransformerOptimus/SuperAGI` | scanned | 385 | 1 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `eff_compression_potential`, `sec_owasp_llm01_injection`, `struct_missing_format_enforcer` |
| `microsoft/semantic-kernel` | scanned | 1194 | 3 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `clarity_missing_quantifier`, `clarity_open_ended`, `clarity_vague_words`, `eff_compression_potential`, `sec_owasp_llm02_pii` |
| `microsoft/autogen` | scanned | 32 | 1 | 0 | 0 | `bp_missing_cot`, `bp_missing_few_shot`, `bp_missing_persona`, `sec_unbounded_persona`, `struct_missing_format_enforcer` |

## Top Static Signals

Prompt rules:

- `bp_missing_few_shot`: 888
- `bp_missing_persona`: 858
- `bp_missing_cot`: 677
- `struct_missing_format_enforcer`: 361
- `eff_compression_potential`: 194
- `clarity_missing_quantifier`: 135
- `clarity_vague_words`: 58
- `eff_token_bloat`: 15
- `sec_unicode_injection_obfuscation`: 10
- `sec_owasp_llm02_pii`: 8

MCP rules:

- `MCP-007`: 10
- `MCP-006`: 6
- `MCP-003`: 3

## False-Positive Notes And Limitations

- This benchmark does not manually confirm exploitability.
- Some findings may come from examples, templates, or intentionally vulnerable fixtures that were not excluded by default ignores.
- Secret-like strings may be fake, redacted, or non-production tokens; each requires review before disclosure.
- Missing MCP auth indicators may be configured outside the checked JSON file.
- Unknown remote domains are review signals, not proof of malicious infrastructure.
- Results can change as repositories change.

## Reproduce

```bash
npm run build --workspace packages/core
npm run build --workspace packages/cli
node scripts/run-public-benchmark.js
```
