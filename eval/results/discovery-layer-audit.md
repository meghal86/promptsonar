# Discovery-layer fix — re-audit (research integrity)

Branch: `claude/discovery-layer-fix-docs-tests` (off the post-Prompt-2 HEAD).
Scope of the fix: documentation, example, and test files are no longer
classified as executable artifacts (TOOL/MEMORY/WORKFLOW/PROMPT) and their
security findings / reachable paths are excluded instead of emitted-and-
downranked. Same deterministic re-audit as before (seed 20260703, ≤2 claims per
repo, drawn from security findings ∪ reachable paths), each claim verified
against cloned source.

## Corpus deltas (committed post-Prompt-2 → post-fix)

| Metric | post-P2 | post-fix | Δ |
|---|---|---|---|
| Total findings | 2002 | 760 | **−62%** |
| — non-production "reference-context" (potential) | 1591 | 197 | −88% |
| Total execution paths | 2650 | 1718 | −35% |
| Cross-file paths | 722 | 660 | −9% |
| Repos with a cross-file path | 19 | 17 | −2 |

Per-repo "has a reachable path to X" (these were suspected of being inflated by
docs-as-executors — they now drop, and the Confirmed counts drop with them):

| Action | reposWithPath | Confirmed repos |
|---|---|---|
| Shell | 89.2% → **81.1%** | 24 → 18 |
| Filesystem | 78.4% → **64.9%** | 25 → 20 |
| Secrets | 94.6% → **89.2%** | 30 → 28 |
| Network | 83.8% → **78.4%** | 29 → 26 |

## False-positive rate

| Sample | FP rate |
|---|---|
| Pre-fix (post-P2 engine), 20 claims | **90%** (18 FP) |
| Post-fix, 20 claims, same seed | **70%** (14 FP, 6 TP) |

By tier (post-fix, small n): Confirmed 4/8 FP (50%) · Probable 8/10 FP · Potential 2/2 FP.
The 6 true positives are all real executors: an Anthropic API client, a Pinecone
network store, an Azure credential read, a bash-subprocess tool registry, aider's
git filesystem ops, and an OpenHands SKILL.md that instructs running a script.

## What the fix achieved

The docs-as-executor class is essentially gone. Pre-fix, ~14 of 18 FPs were
documentation/example/test content (```bash/```yaml examples, sample emails,
doctest output, a doc misclassified as a TOOL with "Confirmed" Shell sinks).
Post-fix, only **1 of 14** FPs is a residual doc: a `how_to_*.md` under
`third_party/VoyageAI/` — a how-to markdown that sits under no recognized doc
directory, so location-based detection missed it.

## New dominant FP classes revealed (NOT the docs-as-executor bug — reported, not fixed, per instructions)

The re-audit surfaces a different, now-dominant family: **rule precision on
production code**, plus **sensitive-action keyword misattribution in paths**.

FP families among the 14:
- **Security rules firing on Python docstrings/comments — 3.** A module docstring
  ("RunState class for serializing…") → `sec_mcp_tool_poisoning`; a config-field
  docstring mentioning "bash" → `sec_privileged_sink_access`; a class docstring →
  `sec_privileged_sink_access`.
- **Sensitive-action keyword misattribution in reachable paths — 4.** LLM "tokens"
  → Secrets; a base "memory" abstraction → Secrets; a regex name-*validator* and
  a PII-redaction middleware → External APIs (non-executors flagged).
- **Format/NL misread by rules — 3.** A UUID-validation regex → `sec_owasp_llm02_pii`;
  a legitimate Russian i18n string ("Максимум ходов") → `sec_homoglyph_evasion`;
  a normal text-to-SQL prompt template → `sec_rag_injection`.
- **MCP-003 over-privilege on benign configs — 2.** Two read-only HTTP reference/
  docs MCP servers (no shell/fs/automation) flagged as over-privileged.
- **UI display components as execution paths — 1.** React find-widget/tooltip/
  button components flagged as an External-APIs cross-file path.
- **Residual documentation — 1.** A `how_to_*.md` outside any `docs/` directory.

## Bottom line

FP rate moved 90% → 70% and true positives tripled (2 → 6); the docs-as-executor
root cause is fixed. It is not yet publishable at 70%. The remaining FPs are a
distinct class — security-rule precision on production code (docstrings, format
regexes, i18n, benign MCP configs) and sensitive-action keyword attribution in
paths — which would be the next fix, not addressed here.
