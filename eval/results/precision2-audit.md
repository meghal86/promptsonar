# Priority-1/2 precision fix — re-audit (research integrity)

Branch: `claude/discovery-layer-fix-docs-tests`. This round implemented the two
fixes proposed as the path from 60% → 40%:
- **P1** — stop a finding's remediation `fix` text (and bare `token`) from driving
  sink inference (`inferWorkflowForFinding`, the classified-artifact sink pass,
  and the credential sink pattern).
- **P2** — stop the parser from extracting a docstring as a scannable prompt.

Same deterministic re-audit (seed 20260703, ≤2/repo), each of 20 claims verified
against source.

> Environment note: the ephemeral wild-corpus clones were wiped by a mid-task
> environment reset and re-cloned from the current default branches (fresh
> snapshots), so absolute numbers are not directly comparable to the prior 60%
> audit (different file contents). To isolate the fix's effect, both builds were
> run on the SAME fresh clones.

## Result

| | value |
|---|---|
| FP rate (post-P1/P2) | **65%** (13 FP, 7 TP) |
| By tier | Confirmed **3/8 FP (38%)** · Probable 8/10 · Potential 2/2 |

**This did NOT reach 40%.** The 60%→40% estimate was wrong: it assumed the fresh
sample would be dominated by the finding-text and docstring FPs P1/P2 target. It
is not.

## What P1/P2 DID achieve (verified, not a regression)

- Same-clone volume: findings **723 → 620 (−14%)**, execution paths
  **1414 → 1286 (−9%)**, cross-file **520 → 503 (−3%)**.
- Spot-checked target FPs eliminated: `_base_memory.py` Secrets (from
  `cancellation_token`) gone; the autogen client docstring **security issues**
  gone. The precision-regression suite (11 assertions) passes; full core suite
  295 passed.

## Why the rate didn't move — the fresh sample's dominant classes are different

FP categories among the 13:
- **Sink label from file-content keyword/prose — 5.** `execute_command` (a tool-name
  string) → Shell; a "shell tool runs in the session dir" sentence in generated
  skill-context prose → Shell; a PII-redaction regex `api_key: /sk-.../` → Secrets;
  a website prompt-library **data JSON** → Shell/Secrets/External-API; a pure
  type-definitions module → Secrets/External-API. P1 fixed the *remediation-text*
  and *bare-token* vectors — these come from OTHER content keywords, via
  `detectSensitiveActions(content)` at classification time, which P1/P2 did not touch.
- **Cross-file co-location — 3.** A skill `.md` linked to its OWN reference docs; a
  router linked to an UNRELATED skill it never references; two DIFFERENT-plugin
  configs. The Prompt-2 reference gate is still too loose.
- **Cluster-1 docstring residual — 1.** A method docstring still flagged
  `sec_owasp_llm01_injection` — the module docstring is extracted via the
  `full_file` path, which bypasses the tree-sitter docstring guard P2 added.
- **Other — 4.** delegation (executor in another module), a bounded persona flagged
  unbounded, a benign docs-retrieval skill, example PII in a RAG data file.

## The actual path to 40% (revised, grounded in these 13 FPs)

- **Lever B — content-prose sink stripping (removes ~5).** Strip comments/docstrings
  and require an actual sink *code construct* (not a tool-name string, a prose
  mention, or a regex literal) in `detectSensitiveActions(content)` at
  classification, and exclude data-only JSON. This is the biggest lever.
- **Lever A — tighten the cross-file reference gate (removes ~3).** A skill→its-own-docs
  link, a co-mention, and different-plugin configs must not form an execution edge.

B + A would remove ~8 of 13 → roughly 25% FP. P1/P2 (this round) were narrower
than the dominant classes and moved volume, not rate.
