# PromptSonar Agent Instructions

This is the canonical shared instruction file for coding agents working in this
repository, including Codex and Claude Code. Tool-specific files may add local
supplements, but they must not contradict this file.

PromptSonar is a **TypeScript monorepo** using npm workspaces. It is a
local-first static security scanner for prompts, agent instructions, and MCP
configs.

## Operating Principles

- Prefer small, reviewable diffs and keep behavior deterministic.
- PromptSonar is intentionally offline and makes zero LLM calls.
- When changing rules or engine behavior, add or update tests so the change is
  provable and non-regressive.
- Avoid introducing new heavyweight dependencies unless there is a clear need.
- Do not commit secrets. Use `.env` and keep `.env` out of git.

## Repo Layout

- `packages/core` - scanning engine and rules
- `packages/cli` - CLI wrapper
- `packages/dashboard` - playground UI
- `packages/claude-code` - Claude Code adapter
- `packages/cursor-extension` - Cursor extension
- `packages/vscode-extension` - VS Code extension
- `action` - GitHub Action wrapper
- `docs/` - documentation and release notes
- `tests/` / `packages/*/tests` - test suites, varying by package

## Common Commands

- Install: `npm ci`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`
- Smoke test: `npm run smoke:features`
- MCP benchmark: `npm run benchmark:mcp`

## Change Workflow

1. Identify the package or packages impacted.
2. Add or adjust tests first when feasible, especially for rule and engine
   behavior changes.
3. Implement the smallest scoped change.
4. Run the narrowest relevant verification, such as
   `npm test --workspace packages/core`, then broader relevant checks.
5. Inspect the final diff before reporting completion.

## Coding Agent Operating Rules

### Read Before Editing

Before changing code:

- read the relevant implementation
- read nearby tests
- inspect relevant types, schemas and documentation
- trace the current behavior
- identify the root cause before proposing a fix
- check whether similar behavior already exists elsewhere in the repository

Do not edit based only on filenames, screenshots or assumptions.

### Think Before Coding

Before implementation:

- state material assumptions
- identify materially different interpretations
- compare materially different approaches when necessary
- prefer the smallest implementation consistent with the existing architecture
- push back when a requested approach would introduce unnecessary complexity or
  violate an existing contract

Ask for clarification only when ambiguity could materially affect:

- architecture
- public APIs
- output schemas
- persisted data
- security behavior
- destructive operations
- backwards compatibility
- externally visible behavior

For minor ambiguity:

- choose the smallest safe and reversible interpretation
- state the assumption
- continue independently

Do not stop for minor implementation choices that can be resolved from
repository conventions.

### Define Success Before Editing

Convert every non-trivial request into observable success criteria.

For non-trivial tasks, provide a brief plan:

1. Step -> verification
2. Step -> verification
3. Step -> verification

For bugs:

1. reproduce the failure
2. identify the root cause
3. add or identify a regression test
4. implement the smallest fix
5. run the targeted test
6. run broader relevant checks
7. inspect the final diff

Do not use vague goals such as:

- make it work
- improve the code
- fix everything
- clean this up

### Simplicity First

Implement the minimum clear solution that satisfies the request.

Do not add:

- unrelated features
- speculative flexibility
- premature abstractions
- unnecessary configuration
- broad frameworks for one use case
- unrelated cleanup
- architecture changes that were not requested

Prefer the smallest clear implementation, not merely the fewest lines. Do not
compress readable code only to reduce line count.

Add defensive error handling at real boundaries such as:

- user input
- file parsing
- external APIs
- network calls
- databases
- untrusted configuration
- security-sensitive operations

Do not add speculative error handling for impossible internal scenarios unless
the repository already expects it.

### Surgical Changes

Every changed line must trace directly to:

- the requested behavior
- a necessary regression test
- required documentation
- cleanup directly caused by the change

Do not:

- reformat unrelated files
- rename unrelated symbols
- rewrite unrelated comments
- refactor adjacent code without necessity
- replace existing patterns based only on preference
- delete pre-existing dead code unless explicitly requested
- modify unrelated behavior

Match existing:

- naming
- style
- structure
- architecture
- test patterns

Remove only imports, variables, functions or files made unused by the current
change. When unrelated problems are discovered, mention them separately instead
of fixing them.

### Preserve Existing Contracts

Before modifying behavior, inspect relevant:

- public APIs
- exported types
- output schemas
- database schemas
- CLI contracts
- configuration formats
- UI contracts
- test fixtures
- integration behavior
- backwards-compatibility expectations

Do not silently change a contract.

When a contract change is explicitly required:

- state it clearly
- update relevant tests
- update relevant documentation
- report compatibility impact
- avoid unrelated contract changes

### Test-Driven Bug Fixing

For bugs:

1. reproduce the issue
2. identify the root cause
3. add or identify a failing regression test
4. implement the smallest root-cause fix
5. run the targeted test
6. run broader relevant checks
7. inspect the final diff
8. verify the observable behavior

Do not:

- weaken a valid test merely to make it pass
- delete a test without explaining why it is invalid
- change expected output to hide a regression
- patch only the visible symptom when the root cause can be fixed
- claim a root cause without tracing the relevant code path

### Verification Requirements

Before claiming completion:

- run the narrowest relevant tests
- run the appropriate broader test suite
- run build checks when applicable
- run lint when applicable
- run type checking when applicable
- inspect the final diff
- verify the requested behavior
- check for unrelated modifications
- verify all affected surfaces when a change crosses packages or applications

Never claim:

- a command passed unless it was executed
- a test passed unless it was executed
- a build passed unless it was executed
- behavior is correct based only on compilation
- backend or engine correctness based only on screenshots
- cross-surface consistency after testing only one surface
- a bug is fixed without directly reproducing or verifying it
- generated or mocked output is real production output

Clearly distinguish:

- verified facts
- inferred behavior
- assumptions
- untested areas
- checks that could not be run

If a command fails, report:

- the exact command
- the failure
- whether it appears related to the current change
- what remains unverified

Do not hide failed checks.

### Scope Protection

Before making a change, classify it as:

- required for the requested result
- required for verification
- directly caused cleanup
- unrelated

Do not implement unrelated items.

If a significantly broader solution exists:

- mention it briefly
- implement the smallest correct scoped solution
- do not silently expand the task

### Stop Conditions

Stop and ask before proceeding when the task requires:

- destructive deletion of important data
- force-pushing or rewriting shared history
- changing real credentials or secrets
- destructive database migrations
- disabling security controls
- bypassing authorization
- introducing an unrequested breaking API change
- replacing a major architecture
- modifying production infrastructure with unclear impact
- suppressing failing tests without understanding the failure

For normal implementation ambiguity, continue with the smallest safe reversible
interpretation.

### Completion Report

At the end of every coding task, report:

- Root cause or requirement: what caused the issue or what requirement drove the
  implementation.
- Changes made: the files and behavior changed.
- Verification performed: the exact commands and tests actually run.
- Results: what passed and what failed.
- Unverified items: anything not tested or unavailable in the environment.
- Scope check: whether unrelated files or behavior were changed.

Do not end with vague statements such as:

- should work
- looks correct
- everything is fixed
- tests should pass

Use evidence-based completion statements.

## Project-Specific Invariants

- PromptSonar is a TypeScript npm-workspaces monorepo. Root `package.json`
  declares workspaces for `packages/*` and `action`.
- Root `package.json` defines the repo-level build, test, lint, smoke, and MCP
  benchmark commands. Use those commands as the authoritative common command
  list.
- PromptSonar is local-first and deterministic. `README.md`, `AGENTS.md`, and
  `.codex/AGENTS.md` state that scanner behavior makes zero LLM calls.
- Keep package boundaries intact: `packages/core` contains the scanning engine
  and rules, `packages/cli` wraps the CLI, `packages/dashboard` contains the
  playground UI, `packages/claude-code` contains the Claude Code adapter,
  `packages/cursor-extension` and `packages/vscode-extension` contain editor
  integrations, and `action` contains the GitHub Action wrapper.
- Engine or rule behavior changes belong in `packages/core` and require tests
  that prove the rule or engine change is deterministic and non-regressive.
- CLI, dashboard, Claude Code, editor integrations, GitHub Action, SARIF, and CI
  surfaces should stay consistent when they expose the same core scanner output;
  `README.md` describes these integrations over the same local engine.
- Prefer the narrowest workspace verification first, such as
  `npm test --workspace packages/core`, before broader checks.
- The dashboard is a Next.js app in `packages/dashboard`; its local development
  command is `npm run dev --workspace packages/dashboard`, documented in
  `docs/testing.md`.
- Release and demo verification commands are documented in `docs/testing.md`,
  including `npm run smoke:features`, `npm run benchmark:mcp`,
  `bash tests/runner/test_mcp_audit_exit_codes.sh`, and
  `npm run release:hygiene`.
- Do not commit secrets. Use `.env` for local secrets and keep it out of git.
- Avoid new heavyweight dependencies unless there is a clear need.

## Codex Usage

- Use `.codex/config.toml` for repo-local defaults.
- `.codex/AGENTS.md` may provide Codex-specific supplements, but the root
  `AGENTS.md` remains the shared source of truth.
- If you have the ECC plugin installed, prefer its workflows for review and
  verification.
