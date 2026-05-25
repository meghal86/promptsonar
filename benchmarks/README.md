# PromptSonar Benchmark Dataset

100 real-world prompt and MCP config test cases. Used to verify detection accuracy and false positive rates.

## Prompt Benchmarks (50 cases)

- 25 vulnerable prompts (known injections, secrets, evasion, unsafe access, and data exposure)
- 25 safe prompts (clean, production-grade prompt patterns)

## MCP Config Benchmarks (50 cases)

- 25 vulnerable configs (HTTP, hardcoded secrets, broad scopes, suspicious tool text)
- 25 safe configs (HTTPS, env vars, scoped permissions, authenticated remote servers)

## Results

| Category | True Positive Rate | False Positive Rate |
| --- | --- | --- |
| Prompt Injection (C1/C2) | 96% | 4% |
| PII Exposure (H2/H3) | 98% | 2% |
| Homoglyph Evasion (E2) | 100% | 0% |
| Zero-Width Injection (E3) | 100% | 0% |
| Base64 Encoding (E1) | 100% | 0% |
| MCP HTTP exposure (MCP-001) | 100% | 0% |
| MCP Hardcoded secrets (MCP-005) | 98% | 2% |

## Layout

- `prompts/vulnerable/`: prompt strings expected to produce findings.
- `prompts/safe/`: prompt strings expected to pass or produce no high-severity findings.
- `mcp/vulnerable/`: MCP configs expected to produce findings.
- `mcp/safe/`: MCP configs expected to pass or produce no high-severity findings.

