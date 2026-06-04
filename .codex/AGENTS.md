# Codex Supplement — PromptSonar

This file supplements the root `AGENTS.md` with Codex-specific expectations.

## Default Mode

- Prefer running in the `strict` profile (read-only / on-request approvals) for
  investigation and review.
- Switch to `yolo` only for local refactors where you explicitly want automatic
  writes.

## Verification

- Favor workspace-scoped runs:
  - `npm test --workspace packages/core`
  - `npm test --workspace packages/cli`
  - `npm run build --workspace packages/core`
- When changing the CLI surface, also run `npm run smoke:features`.

## Safety

- Never add telemetry, remote calls, or LLM usage. PromptSonar is local-first by
  design.
- Treat any change that could reduce detection coverage as security-sensitive;
  justify it in the PR description and add regression tests.
