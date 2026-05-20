# PromptSonar Active Sprint Checklist

Use `[x]` for completed, `[/]` for in progress, and `[ ]` for pending.

## Sprint 0 - Release Credibility

- [x] Fix known build blockers.
  - [x] Verify `@promptsonar/core` tests.
  - [x] Verify `@promptsonar/cli` build.
  - [x] Fix `packages/dashboard` production build.
  - [x] Verify VS Code extension compile.
- [x] Clean release hygiene.
  - [x] Expand `.gitignore` for generated artifacts.
  - [x] Remove generated artifacts from Git tracking where needed.
  - [x] Align CLI hardcoded version with package version.
  - [x] Remove or quarantine unrelated project folders before public launch.
  - [x] Add release hygiene check script.
- [x] Verify npm publish for `@promptsonar/cli`.
  - [x] Check published version number matches `packages/cli/package.json`.
  - [x] Confirm clean install and runtime version: `npx @promptsonar/cli --version`.
- [/] Publish v1.1.0 MCP audit release.
  - [x] Bump local packages to `1.1.0`.
  - [x] Build CLI, core, dashboard, action, and VS Code extension.
  - [x] Create VS Code Marketplace package artifact.
  - [x] Run npm publish dry-runs.
  - [ ] Publish `@promptsonar/core@1.1.0` to npm.
  - [ ] Publish `@promptsonar/cli@1.1.0` to npm.
  - [ ] Publish `promptsonar-tools.promptsonar@1.1.0` to VS Code Marketplace.
- [x] Credibility polish.
  - [x] Add `ADOPTION.md` evidence log.
  - [x] Update README with 30-second demo.
  - [x] Replace mock-only claims with verified claims.
  - [x] Save baseline screenshots for public links and metrics.

## Sprint 1 - MCP Security Wedge

- [x] Implement `promptsonar audit-mcp`.
  - [x] Add core MCP config auditor.
  - [x] Add CLI command with optional target path.
  - [x] Add auto-discovery for Claude, Cursor, and local MCP configs.
  - [x] Add terminal output.
  - [x] Add JSON output.
  - [x] Add SARIF output.
- [x] Add MCP rules.
  - [x] `MCP-001`: unencrypted or exposed unauthenticated server.
  - [x] `MCP-002`: over-broad filesystem/shell/admin/network scope.
  - [x] `MCP-003`: remote server missing auth indicators.
  - [x] `MCP-004`: suspicious tool description or injection string.
  - [x] `MCP-005`: hardcoded secrets.
  - [x] `MCP-006`: unknown remote domain requiring review.
  - [x] `MCP-007`: legacy or malformed config shape.
- [x] Add fixtures and tests.
  - [x] Vulnerable MCP config.
  - [x] Safe MCP config.
  - [x] Core auditor tests.
  - [x] CLI exit code tests.

## Sprint 2 - Enterprise Proof

- [x] Add GitHub Action examples with SARIF upload.
- [x] Add `pre-commit` and GitLab CI examples.
- [x] Add org policy example for MCP review gates.
- [x] Add enterprise rollout checklist.
- [x] Add anonymized pilot feedback template.
- [x] Create sample JSON/SARIF/Markdown evidence report.
- [x] Add reproducible MCP benchmark fixtures and runner.
- [x] Prepare design-partner outreach and testimonial capture template.
- [ ] Collect permissioned testimonials or anonymized proof from design partners.

## Sprint 3 - Public Acclaim

- [x] Write technical launch article.
- [x] Publish benchmark results with reproducible fixtures and false-positive notes.
- [/] Submit MCP security paper to arXiv (`cs.SE`).
  - [x] Create preprint draft.
  - [x] Expand benchmark/evaluation section.
  - [ ] Submit through arXiv account.
- [x] Prepare Hacker News Show HN post.
- [x] Prepare Product Hunt assets after technical launch is stable.
- [x] Pitch security newsletters.
- [x] Submit talk proposals to AI security/AppSec meetups.
- [x] Draft OWASP GenAI/MCP community contribution package.
- [ ] Submit OWASP GenAI/MCP community contribution.
- [x] Document external mentions in `ADOPTION.md`.
  - [x] Log confirmed AI:PRODUCTIVITY and DEV Community links.
  - [x] Add exact Hacker News URL.
  - [x] Add exact Medium URLs.
  - [x] Add baseline GitHub, npm, and VS Code links.
  - [x] Save screenshots for all external mentions under `/evidence/`.
- [x] Update `ADOPTION.md` with first metrics snapshot after launch.
- [x] Draft v1.1.0 MCP audit release notes.

## Sprint 4 - Optional Dashboard

- [ ] Keep dashboard optional until CLI adoption is proven.
- [ ] Harden Stripe webhook and Supabase RLS.
- [ ] Add hosted scan history.
- [ ] Add org policy management.
