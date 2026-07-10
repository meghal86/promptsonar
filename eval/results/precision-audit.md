# Rule/sink-precision fix — re-audit (research integrity)

Branch: `claude/discovery-layer-fix-docs-tests`. Fix scope: Cluster 1
(security rules firing on docstring/comment prose) and Cluster 2 (sink-type
misattribution from a bare keyword). Same deterministic re-audit (seed 20260703,
≤2/repo, security findings ∪ reachable paths), each claim verified against source.

## False-positive rate across the three fixes

| Engine state | FP rate | TP |
|---|---|---|
| post-Prompt-2 | 90% | 2/20 |
| + discovery-layer fix | 70% | 6/20 |
| **+ rule/sink-precision fix** | **60%** | **8/20** |

By tier (post-precision): Confirmed **3/8 FP (38%)** · Probable 9/12 FP (75%).
The 5 Confirmed true positives are all real executors: cline's OpenRouter API
call and its API-key handling, pydantic-ai's compiled GitHub-Actions agent
(GitHub API/OTLP/MCP with injected creds), langchain's `/bin/bash` tool
middleware, and repomix's MCP `fs.readFile` tool.

Corpus (post-discovery → post-precision): findings 760 → 722, execution paths
1718 → 1398, cross-file paths 660 → 513.

## What the precision fix achieved

- **Cluster 2 (file-content keyword misattribution): fixed.** None of the 12
  FPs is the file-content `token`→Secrets or URL/`api.`→External-API class.
  Verified directly: `_base_memory.py` (`cancellation_token`), langchain
  huggingface (`max_tokens`), and the `max_tokens`/`token_limit` fixture no
  longer get a Secrets/External-API label.
- **Cluster 1 (docstring/comment prose): fixed at the rule level.** The 9-assertion
  fixture suite passes and both audited autogen client files return no findings
  when the rule sees the whole file. See the residual below for the pipeline gap.

## FP breakdown of the 12 remaining (by category)

| Category | # | Cluster? |
|---|---|---|
| Cluster-1 docstring residual (parser extraction) | 2 | Cluster 1 (partial) |
| Cross-file co-location (no real reference) | 2 | Prompt-2 residual |
| Sink label from a finding's *remediation text* ("secrets") | 2 | new (Cluster-2 adjacent) |
| Sink misattribution (other keyword/DB-store) | 2 | new (Cluster-2 adjacent) |
| CI-workflow-as-agent-sink | 1 | new |
| i18n locale file named `mcp.json` classified as MCP | 1 | new |
| Unicode-injection rule on normal skill prose | 1 | new |
| Skill/doc instruction treated as a network sink | 1 | new |

### The Cluster-1 residual (honest limitation)

`#18` and `#20` (autogen `_openai_client.py` / `_anthropic_client.py`) are class
docstrings ("Chat completion client … Args: api_key …") that mention `bash`.
The rule-level docstring strip does not catch them because the repo **parser
extracts a triple-quoted docstring as a standalone prompt string** (delimiters
already removed) before the rule runs — and a docstring is indistinguishable
from a real prompt string (`SYSTEM_PROMPT = """…"""`) without AST-level docstring
detection. Stripping all triple-quoted strings pre-parse would break real
prompt-in-string detection. Completing this needs a parser-level change, which
is beyond the assigned rule-level scope and is NOT attempted here.

## Not fixed (per instruction — new FP classes)

The remaining 10 FPs are distinct classes expected to remain and deliberately
not addressed: cross-file co-location residual, sink labels derived from a
finding's generic remediation text, CI-workflow-as-sink, i18n-file-as-MCP
classification, unicode-rule precision, and skill-instruction-as-sink. FP rate
is 60% — improved and honest, still not publishable; each remaining class is a
separate, well-scoped fix.
