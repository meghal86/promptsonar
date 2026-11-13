# Contributing to PromptSonar

Thanks for helping. The most useful contributions right now are **false-positive
and false-negative reports from real repositories** — they are how the rules get
more precise. Code contributions are welcome too.

## Reporting a false positive or a missed finding

Open an issue with the **False positive / missed finding** template. Include:

- the rule id (e.g. `sec_owasp_llm01_injection`),
- the file path and line, and a minimal snippet that reproduces it,
- what you expected (no finding, a different severity, or a finding that was missed),
- the PromptSonar version (`promptsonar --version`).

If the snippet comes from someone else's project, reduce it to the smallest
example that still reproduces the result. If you think you found a real
vulnerability in another project, report it to that project privately, not in
a PromptSonar issue.

## Development setup

Requires Node.js 20 or newer.

```bash
npm ci
npm run build
npm test
npm run lint
```

Other checks that CI runs on every pull request:

```bash
npm run smoke:features   # end-to-end CLI feature checks
npm run benchmark:mcp    # MCP audit benchmark
npm run release:hygiene  # no generated files tracked; all versions agree
```

## Repository layout

| Path | What it holds |
|---|---|
| `packages/core` | Scanning engine and rules |
| `packages/cli` | `promptsonar` CLI |
| `packages/vscode-extension`, `packages/cursor-extension` | Editor integrations |
| `packages/claude-code` | Claude Code adapter |
| `packages/dashboard` | Playground and dashboard (Next.js) |
| `action` | GitHub Action (its built `dist/` is committed; GitHub runs it as-is) |

## Ground rules

- **No LLM calls in the scanning pipeline.** PromptSonar is deterministic and
  local-first; the same input always gives the same result.
- **Every behaviour change needs a regression test.** For a rule fix, add a
  test from the real case that triggered it: a negative case that must stay
  quiet and, where relevant, a positive case that must keep firing. Core tests
  live in `packages/core/tests/`, fixtures in `packages/core/test/fixtures/`.
- **Keep diffs small and focused.** One fix per pull request where possible.
- **Avoid new heavyweight dependencies** unless there is a clear need.
- **If you change `action/src` or core code the Action uses**, rebuild the
  Action (`npm run build --workspace action`) and commit `action/dist/`. CI
  fails if the committed bundle is out of date.
- **Never commit secrets.** Use `.env` locally; it is git-ignored.

## Pull requests

Describe what changed and why, link the issue, and say how you verified it
(which tests you added or ran). CI must pass before merge.
