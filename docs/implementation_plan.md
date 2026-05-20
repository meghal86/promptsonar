# PromptSonar Sprint Plan - Open Source Adoption and EB-1A Evidence

This plan prioritizes public technical impact over revenue. The goal is to make PromptSonar a recognized open-source AI security project with credible adoption evidence: GitHub stars, npm downloads, VS Code installs, enterprise usage, third-party coverage, citations, talks, and testimonials.

## North Star

Position PromptSonar as:

> Local-first security scanner for AI prompts, MCP configs, and agent tool poisoning. No LLM calls.

The flagship adoption wedge is:

```bash
npx @promptsonar/cli audit-mcp
```

## Evidence Targets

- GitHub: 1k stars initial target, then 5k+ with sustained star velocity.
- npm: weekly downloads tracked for `@promptsonar/cli` and `@promptsonar/core`.
- VS Code: installs, ratings, and marketplace reviews.
- Enterprise: at least 5 named or anonymized teams using PromptSonar in CI/IDE.
- Technical recognition: posts, newsletters, podcasts, conference talks, OWASP/community references.
- Public proof: reproducible benchmark repo with vulnerable/safe MCP and prompt fixtures.

## Sprint 0 - Release Credibility and Hygiene

Objective: make the repository trustworthy before public launch.

- [x] Fix production build failures across CLI, core, dashboard, VS Code extension, and GitHub Action.
- [x] Remove or ignore generated artifacts: `dist`, `coverage`, `.next`, `*.vsix`, virtualenvs, local scratch outputs, and unrelated project folders.
- [x] Align package versions and CLI runtime version.
- [x] Make README first-screen conversion strong: problem, install, 30-second demo, local-first trust claim, screenshots.
- [x] Replace unsupported claims with verified wording. Do not market mock-only tests as production semantic drift detection.
- [x] Add a public `ADOPTION.md` evidence log template for stars, downloads, installs, mentions, testimonials, and enterprise pilots.

## Sprint 1 - MCP Security Wedge

Objective: ship the feature most likely to get GitHub stars and security-community attention.

- [x] Add `promptsonar audit-mcp [path]`.
- [x] Auto-discover:
  1. `~/Library/Application Support/Claude/claude_desktop_config.json`
  2. `~/.config/claude/claude_desktop_config.json`
  3. `%APPDATA%/Claude/claude_desktop_config.json`
  4. `./claude_desktop_config.json`
  5. `./.cursor/mcp.json`
  6. `./mcp.json`
- [x] Implement MCP rules:
  - `MCP-001` critical: unencrypted HTTP or exposed unauthenticated local/network server.
  - `MCP-002` high: over-broad filesystem, shell, admin, or network scope.
  - `MCP-003` high: remote server missing authentication indicators.
  - `MCP-004` medium: suspicious tool descriptions or prompt-injection strings.
  - `MCP-005` high: hardcoded secrets in args, env, headers, or URLs.
  - `MCP-006` medium: unknown remote domain requiring review.
  - `MCP-007` low: legacy or malformed config shape.
- [x] Output terminal, JSON, and SARIF.
- [x] Add tests with intentionally vulnerable and safe MCP configs.
- [x] Add README section mapping findings to OWASP MCP Top 10 and OWASP LLM Top 10.

## Sprint 2 - Enterprise Proof

Objective: make adoption easy for security teams.

- [x] GitHub Action path with SARIF upload examples.
- [x] CI templates for GitHub Actions, GitLab, and pre-commit.
- [x] Policy file examples for org-level controls.
- [x] Evidence report artifact: JSON/SARIF/Markdown with stable rule IDs and remediation.
- [x] Anonymized enterprise pilot package: install guide, 15-minute rollout checklist, feedback form.
- [ ] Collect permissioned testimonials or anonymized proof from design partners.

## Sprint 3 - Public Acclaim Engine

Objective: turn technical work into third-party recognition.

- [x] Publish technical article: "MCP config is the new AI supply-chain attack surface."
- [x] Publish benchmark results with reproducible fixtures and false-positive notes.
- [x] Submit to Hacker News as a technical Show HN, not a marketing launch.
- [x] Prepare Product Hunt assets after README, demo, and install path are polished.
- [x] Prepare security newsletter and AI engineering newsletter pitches with concrete examples.
- [x] Prepare talk proposal for AI security, AppSec, and developer tooling meetups.
- [ ] Contribute findings/rules back to OWASP GenAI/MCP communities where appropriate.

## Sprint 4 - Dashboard and Commercial Layer

Objective: support enterprise usage without distracting from open-source adoption.

- [ ] Keep dashboard optional.
- [ ] Fix Stripe and Supabase hardening only after CLI/MCP adoption is strong.
- [ ] Add hosted scan history and organization policy management.
- [ ] Add billing only when it does not slow open-source credibility.

## EB-1A Evidence Discipline

Every sprint should produce artifacts an attorney can cite:

- Screenshots of GitHub stars, forks, contributors, npm downloads, VS Code installs.
- Public links to media, talks, posts, podcasts, and third-party writeups.
- Signed or email-based enterprise testimonials.
- Release notes showing sustained progress.
- Independent issues/PRs from users.
- Benchmarks proving original technical contribution.

This is not legal advice. The engineering goal is to create real, public, verifiable field recognition.
