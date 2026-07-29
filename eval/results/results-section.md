# Evaluation (draft results section)

> Draft prose for the AISec 2026 submission, generated from the committed result
> JSONs. Numbers reference Tables 1–5 in `paper-tables.md`. Update the cross-file
> comparison counts after the final `baseline-wild-results.json` (AI-scoped run).

## Experimental setup

We evaluate PromptSonar on two corpora. The **controlled corpus** (Table~\ref{tab:controlled})
contains 22 hand-built cases with ground-truth security findings and execution
paths, spanning single-file and cross-file prompt/skill/agent/MCP/workflow/memory
scenarios, plus four true negatives and explicit restraint cases. The **wild
corpus** (Table~\ref{tab:wild}) is 37 public GitHub repositories—13 MCP servers,
12 agent frameworks, and 12 real-world AI projects (AI coding assistants,
`.cursorrules`, AI-in-CI)—fetched at a pinned snapshot. All PromptSonar scans are
deterministic and make zero LLM calls. As a baseline we use NVIDIA SkillSpector
v2.3.7 in its deterministic `--no-llm` mode; its optional LLM mode is not run, to
preserve determinism and avoid per-scan cost.

## Detection accuracy on the controlled corpus

On the 22 ground-truthed cases, PromptSonar attains **precision 1.00, recall 1.00,
and F1 1.00** (25 true positives, 0 false positives, 0 false negatives), correctly
clears all four true-negative cases, and matches **15/15** expected execution
paths (Table~\ref{tab:controlled}). Scoring counts only security findings
(`sec_*`, `MCP-*`); low-severity configuration-hygiene and code-quality findings
are excluded as non-security noise, per a fixed policy declared in the manifest.

The per-file baseline is a useful contrast. SkillSpector (`--no-llm`) is a
skill/file-level scanner; **10 of the 22 cases—those whose risk is cross-file,
MCP-configuration, or memory-mediated—fall outside its granularity** and are
recorded as out-of-scope rather than scored against it. On the 12 comparable,
single-artifact cases it achieves precision 1.00 but **recall 0.44 (F1 0.62)**,
missing five single-file dangerous instructions that PromptSonar flags (e.g., a
SKILL.md declaring shell execution). The accuracy gap therefore has two
components: SkillSpector misses roughly half of in-scope single-file risks, and an
additional ~45% of the corpus is structurally beyond a per-file tool's reach.

## Prevalence of reachable sensitive actions in the wild

Across the 37 repositories PromptSonar reports 3{,}455 findings and reconstructs
4{,}508 execution paths, of which **2{,}923 (65%) are cross-file**
(Table~\ref{tab:wild}). Aggregating by sink (Table~\ref{tab:headline}), a large
majority of real AI repositories contain at least one reachable path to a
sensitive action: **94.6% reach credential access, 89.2% shell execution, 86.5%
network/external egress, and 78.4% filesystem write.** PromptSonar reports these
with calibrated confidence: most paths are *probable* or *potential* (inferred
from connected structure), while a smaller, high-precision core is *confirmed*
by direct evidence (e.g., 21.6% of repos have a *confirmed* shell path and 18.9%
a *confirmed* credential path). This tiering lets a consumer trade recall for
precision without re-scanning.

## Cross-file paths: the per-file blind spot

The central claim—that whole-repository execution-path analysis surfaces risks
invisible to per-file scanning—is quantified in Table~\ref{tab:crossfile}.
**91.9% of wild repositories (34/37) contain at least one cross-file path**, and
in dependency-heavy frameworks PromptSonar reconstructs 100+ cross-file paths per
repo (e.g., LangChain, Continue, AutoGen, LlamaIndex, Semantic Kernel). To compare
fairly, we run SkillSpector on each repo's extracted AI-artifact surface—the same
prompt/skill/agent/MCP files PromptSonar analyzes (whole-repo scans do not
scale; see below). On this identical surface, across all 37 repositories,
PromptSonar reconstructs **2{,}923 cross-file paths while SkillSpector detects
zero**: it analyzes files independently and has no cross-file execution-path
model. Its 219 per-file findings are a different category (single-file patterns
and dependency CVEs) and are reported only for context; in **19 repositories
PromptSonar surfaces a reachable risk where SkillSpector reports nothing**, and in
none does the reverse hold. This is a structural difference, not a tuning
artifact: a tool that never relates a prompt in one file to a tool or MCP server
defined in another cannot express these paths at all.

## Performance

PromptSonar is fast and single-threaded (Table~\ref{tab:perf}): controlled cases
scan in 0.4s mean (0.2s median), and full wild repositories—several exceeding
300 MB—scan in 10.9s mean (5.0s median, 34.1s max). For comparison, the per-file
baseline does not scale to large monorepos: pointed at whole repositories it times
out independent of dependency-lookup settings, so we evaluate it on each repo's
extracted AI-artifact surface (the same prompt/skill/agent/MCP files PromptSonar
analyzes).

## Limitations and honest negatives

The evaluation records its own gaps. (i) Cross-file edges at *probable*/*potential*
confidence can be co-location–based rather than reference-based; PromptSonar never
promotes these to *confirmed*, and the wild prevalence numbers above are dominated
by the lower tiers. (ii) Hardcoded-secret and base64 detection use strict format
gates and miss short or fake credentials by design. (iii) The wild corpus has no
ground truth, so we report descriptive statistics, not precision/recall, for it.
(iv) The contextual approval-policy reasoning is out of scope for this evaluation.
These are stated so the headline numbers are read at the right confidence.
