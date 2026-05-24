# Design Partner Outreach Draft

Use this after the MCP audit branch is merged and the README shows the `audit-mcp` workflow clearly.

## Target Profiles

- AI security engineers reviewing Claude Desktop, Cursor, or custom MCP usage.
- Platform/security teams piloting agent tooling internally.
- Developer tooling maintainers building MCP servers.
- AppSec teams adding AI security checks to CI.

## Short Message

Subject: Quick feedback request: local MCP config security scanner

Hi `<name>`,

I maintain PromptSonar, an open-source local-first scanner for AI prompts and MCP configuration files.

The new MCP audit command reviews Claude/Cursor/local MCP configs for risky endpoints, broad filesystem/shell scope, missing auth indicators, hardcoded secrets, unknown remote domains, and prompt-injection text in tool descriptions:

```bash
npx @promptsonar/cli audit-mcp
```

I am looking for 3-5 security/dev-tooling teams willing to run it on real or sanitized MCP configs and share short feedback:

- Did it find anything useful?
- Which findings were noisy?
- Which MCP risk patterns are missing?
- Would JSON/SARIF output fit your review or CI workflow?

If your team can share a public quote, that helps. If not, anonymized feedback is still useful.

Project:

```text
https://github.com/meghal86/promptsonar
```

Benchmark evidence:

```text
benchmarks/mcp/results/2026-05-20-mcp-benchmark.md
```

Thanks,
Meghal

## Feedback Capture Template

| Field | Value |
|---|---|
| Organization |  |
| Public attribution allowed? | Yes / No |
| MCP clients used | Claude Desktop / Cursor / Other |
| Configs scanned |  |
| Total findings |  |
| Useful findings |  |
| False positives |  |
| Missing rules |  |
| Would use in CI? | Yes / No / Maybe |
| Quote/testimonial |  |
| Evidence saved to `/evidence/` | Yes / No |

