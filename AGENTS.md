# PromptSonar — Agent Instructions (Codex/Cursor/Claude)

This repository is a **TypeScript monorepo** (npm workspaces) for PromptSonar: a
local-first static security scanner for prompts, agent instructions, and MCP
configs.

## Operating Principles

- Prefer **small, reviewable diffs** and keep behavior deterministic (PromptSonar
  is intentionally offline and makes zero LLM calls).
- When changing rules/engine behavior, add or update tests so the change is
  provable and non-regressive.
- Avoid introducing new heavyweight dependencies unless there is a clear need.
- Do not commit secrets. Use `.env` (and keep `.env` out of git).

## Repo Layout

- `packages/core` — scanning engine + rules
- `packages/cli` — CLI wrapper
- `packages/dashboard` — playground UI
- `action` — GitHub Action wrapper
- `docs/` — documentation and release notes
- `tests/` / `packages/*/tests` — test suites (varies by package)

## Common Commands

- Install: `npm ci`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Smoke test: `npm run smoke:features`

## Change Workflow

1. Identify the package(s) impacted (`core`, `cli`, `dashboard`, `action`).
2. Add/adjust tests first when feasible (especially for rule changes).
3. Implement the change.
4. Run the narrowest verification (`npm test --workspace ...`) then the repo
   standard (`npm test`).

## Codex Usage

- Use `.codex/config.toml` for repo-local defaults (strict by default).
- If you have the ECC plugin installed, prefer its workflows for review and
  verification (TDD, security review, verification loop).
