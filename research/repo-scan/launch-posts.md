# PromptSonar Launch Post Drafts

Evidence source: `results/repo-scan/summary.json` generated on 2026-05-25.

Important framing: these are static-analysis signals from PromptSonar, not manually confirmed vulnerabilities or CVEs. Do not name-and-shame repositories in public posts unless maintainers have reviewed the findings.

## Hacker News

Title option:

I scanned 30 open-source AI repos for prompt security issues

Post:

I built PromptSonar, a local-first static scanner for LLM prompts, MCP configs, and agent tool poisoning. It makes no LLM calls and is meant to run before code ships.

To test whether prompt-security issues are visible in real code, I scanned an initial sample of 30 active open-source AI repositories across Python, TypeScript, and JavaScript.

After excluding docs, tests, examples, fixtures, benchmarks, notebooks, and README/Markdown files, PromptSonar flagged:

- 26/30 repos with high or critical prompt-security signals
- 24/30 repos with high or critical secret/credential signals
- 23/30 repos with high or critical injection/jailbreak signals
- 29/30 repos with clarity or ambiguity issues

These are scanner signals, not CVEs. Some will be false positives, and each finding needs maintainer review. But the result was clear enough to publish a small framework I am calling 7-Factor Prompt Security:

1. Instruction hierarchy
2. Input validation
3. Secret hygiene
4. Output constraints
5. Context isolation
6. Consistency
7. Auditability

The tool is local-first, open source, and maps findings to OWASP LLM Top 10.

Manifesto: https://github.com/meghal86/7-factor-prompt-security

Scanner: https://github.com/meghal86/promptsonar

## X Thread

1/ I scanned 30 active open-source AI repos for prompt-security issues.

Not runtime traffic. Not LLM judging.

Static analysis of prompt strings, MCP/tool configs, and source-level risk patterns.

2/ After excluding docs, tests, examples, fixtures, notebooks, and README/Markdown files, PromptSonar flagged:

26/30 with high/critical prompt-security signals
24/30 with secret/credential signals
23/30 with injection/jailbreak signals
29/30 with clarity/ambiguity issues

3/ These are not CVEs.

They are static scanner signals that need maintainer review.

But they show something real: prompt security problems are often visible before deploy.

4/ My takeaway:

Every production prompt needs 7 checks:

Instruction hierarchy
Input validation
Secret hygiene
Output constraints
Context isolation
Consistency
Auditability

5/ I published the framework here:

https://github.com/meghal86/7-factor-prompt-security

And the local-first scanner here:

https://github.com/meghal86/promptsonar

6/ PromptSonar runs locally.

No LLM calls.
No telemetry.
CLI, VS Code, SARIF, GitHub Action, MCP audit.

It is meant to catch prompt and agent risks before code ships.

## LinkedIn

I scanned an initial sample of 30 active open-source AI repositories for prompt-security risk signals.

This was static analysis only: no LLM calls, no runtime interception, no telemetry. I also excluded docs, tests, examples, fixtures, benchmarks, notebooks, and README/Markdown files from the stricter count.

PromptSonar flagged:

- 26/30 repositories with high or critical prompt-security signals
- 24/30 with secret or credential signals
- 23/30 with injection or jailbreak signals
- 29/30 with clarity or ambiguity issues

Important caveat: these are scanner signals, not confirmed vulnerabilities or CVEs. Each finding needs maintainer review.

The bigger point is that prompt security can be tested before deployment. Many risks are visible directly in source code: unsafe instruction hierarchy, raw user input reaching prompts, hardcoded secrets, weak output constraints, mixed system/user context, inconsistent output contracts, and no audit trail.

I turned that into a simple framework:

7-Factor Prompt Security

1. Instruction hierarchy
2. Input validation
3. Secret hygiene
4. Output constraints
5. Context isolation
6. Consistency
7. Auditability

Manifesto: https://github.com/meghal86/7-factor-prompt-security

Scanner: https://github.com/meghal86/promptsonar

PromptSonar is local-first and maps findings to OWASP LLM Top 10. It supports CLI scans, VS Code diagnostics, SARIF, GitHub Actions, SBOM generation, and MCP config auditing.
