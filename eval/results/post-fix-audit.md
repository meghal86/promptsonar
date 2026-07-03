# Post-fix wild-corpus re-audit (research integrity)

Deterministic 20-claim sample from the post-fix wild-corpus scan (37 repos),
≤2 claims per repo, seed 20260703, drawn from the population of
security findings (1947) ∪ reachable execution paths (2650) = 4597 claims.
Each claim verified against the actual cloned source.

## Result

| | claims | false positives | FP rate |
|---|---|---|---|
| **Overall** | 20 | 18 | **90%** |
| Reachable paths | 10 | 8 | 80% |
| Security findings | 10 | 10 | 100% |

By confidence tier (small n — indicative only):
Confirmed 3/5 FP · Probable 7/7 FP · Potential 8/8 FP.

Pre-fix audit was 85% FP (17/20). Post-fix is 90% (18/20) — **statistically
indistinguishable**; the FP *rate* did not move, even though finding *volume*
dropped 42% and cross-file paths dropped 75%.

## What the fix DID achieve

- Cross-file paths 2923 → 722 (−75%); total findings 3455 → 2002 (−42%).
- Of 18 FPs, exactly **one** (a cross-file UI path whose real executor is in an
  uncited module) is edge-attribution related. **Zero** are the old
  capability-word co-location bug. That class is gone.
- The 2 true positives are both real cross-file/MCP executor paths (Roo-Code
  system-prompt → network `createMessage`; repomix MCP tool → `fs.readFile`),
  confirming the reference-gated edges still surface genuine paths.

## Why the rate didn't move — the now-dominant FP class

The audit surfaced a different root cause the co-location fix never touched:
**documentation, example, and test content is classified as executable
artifacts and scanned for security findings.**

FP families (of 18):
- **Docs / examples — 12.** `sec_privileged_sink_access` / `sec_mcp_tool_poisoning`
  firing on ```bash / ```yaml fences in READMEs, tutorials, and guides; a blog
  and CLI docs producing reachable-path claims; `sec_owasp_llm02_pii` on an
  example `test@example.com` and a doctest float score; and — most serious — a
  `docs/upgrade-guide.md` misclassified as a **TOOL** (its prose mentions
  `tool_dispatcher` / `default_tools`), yielding **Shell/Filesystem/Network
  "Confirmed"** sink paths from a pure documentation file.
- **Action-keyword / attribution — 4.** An in-memory OTel span exporter flagged
  Network (no I/O); `"token"` (LLM tokens) flagged Secrets; a Jira MCP server
  flagged Secrets though credential reading is in an uncited module; a UI panel
  flagged Network cross-file.
- **Test / docstring — 2.** A xUnit test file and a type-definition docstring.
- **Benign config — 1.** A read-only HTTP reference MCP server flagged
  over-privileged (MCP-003) with no elevated capability.

## Implication

The headline per-repo rates (shell 89% / fs 78% / creds 94.6%) are **not** all
backed by real executors: at least one sampled "Confirmed shell executor" is a
documentation file misclassified as a TOOL. The number is partly inflated by
docs-as-executors.

**Not publishable as-is.** The next root-cause fix is at the discovery /
classification layer — exclude (or heavily down-weight) documentation, example,
and test content from (a) artifact classification as executors and (b) security
finding emission. This is the same discovery-layer family as the flagged
zero-width-`.md` and unmarked-`prompt.md` gaps, in the over-inclusion direction.
