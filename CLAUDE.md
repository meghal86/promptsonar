# Claude Code Instructions

Read and follow the root `AGENTS.md` before planning, editing, reviewing,
testing or reporting completion.

`AGENTS.md` is the shared source of truth for:

- coding behavior
- project-specific invariants
- scope limits
- testing expectations
- completion reporting

When instructions conflict:

1. follow the user's explicit current task
2. follow the nearest applicable repository instruction
3. follow the root `AGENTS.md`
4. use the smallest safe reversible interpretation

Do not duplicate or create a separate conflicting instruction system in this
file.

Apply the `karpathy-guidelines` skill by default for implementation, bug fixes,
reviews, refactoring, test creation, architecture-sensitive changes and
security-sensitive changes. Do not require lengthy planning for trivial one-line
changes.

# PromptSonar

Deterministic AI execution-path analysis platform. Zero LLM calls during
scanning.

> Paths and line numbers below reflect the real layout (the engine files live
> under `repository/`, `mcp/`, and `contextual/`, not directly in `src/`).
> Line numbers drift as code changes — treat them as hints and confirm by
> searching for the symbol.

## Structure
- `packages/core/src/repository/analyzer.ts` — artifact classifier, discovery,
  control state
- `packages/core/src/mcp/auditor.ts` — MCP analysis, capability tokens, rule
  engine
- `packages/core/src/contextual/verdict.ts` — contextual verdict engine,
  severity mapping
- `packages/core/src/repository/closure.ts` — repository closure, reference
  expansion
- `packages/core/test/fixtures/` — test fixtures
- `packages/cli/` — CLI entry point

## Key functions
- `classifyFile()` in `repository/analyzer.ts` — assigns artifact types to files
  (exported entry point: `analyzeRepositoryArtifacts()`). There is no
  `classifyArtifact()`.
- `walkRepository()` in `repository/analyzer.ts` — discovers all files
- `controlStateForFinding()` in `repository/analyzer.ts` (~line 2212) — derives
  control state
- `FS_CAPABILITY_TOKENS` in `mcp/auditor.ts` (~line 175) — filesystem detection
  tokens
- `evaluateContextualVerdict()` in `contextual/verdict.ts` — contextual verdict /
  severity mapping
- `analyzeRepositoryExecution()` in `repository/analyzer.ts` — main repo scan
  entry point; `evaluateRepositoryWithClosure()` in `repository/closure.ts` is
  the discovery-first (closure) entry point

## Conventions
- TypeScript, vitest for tests
- Test fixtures go in `packages/core/test/fixtures/`; test files live in
  `packages/core/tests/` (vitest `include` is `tests/**/*.test.ts`)
- CLI flags: `--json`, `--sarif`, `--html`, `--closure`, `--discovery-report`
- No LLM calls ever in the scanning pipeline
- All changes need regression tests
