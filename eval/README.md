# PromptSonar Empirical Evaluation (AISec 2026)

Deterministic evaluation harness. PromptSonar makes **zero LLM calls**; the only
optional LLM path (SkillSpector +LLM) is intentionally not run.

## Layout
```
eval/
  controlled-manifest.json     22 ground-truthed cases (expected findings + paths)
  corpus/
    controlled/                the 22 controlled fixtures
    wild/repos.json            37 public repos (verified, not committed as clones)
    wild/clones/               fetched snapshots (GITIGNORED — never committed)
  scripts/clone-wild.sh        fetch wild repos (depth-1 codeload tarballs)
  run-controlled.ts            score PromptSonar vs ground truth -> results/controlled-results.json
  run-wild.ts                  scan wild repos -> results/wild-results.json
  run-headline.ts              headline % stats -> results/headline-stats.json
  run-baselines.ts             SkillSpector --no-llm on controlled -> results/baseline-results.json
  run-baselines-wild.ts        SkillSpector --no-llm on wild -> results/baseline-wild-results.json
  generate-tables.ts           LaTeX tables -> results/paper-tables.md
  tsconfig.json                ts-node config for the scripts
  VERSIONS.md                  pinned tool versions
  results/                     all output JSONs + paper-tables.md (committed)
```

## Run (from repo root)
```bash
npm run build --workspace packages/core && npm run build --workspace packages/cli   # build engine
TS=eval/tsconfig.json; RUN="node_modules/.bin/ts-node --transpile-only"

TS_NODE_PROJECT=$TS $RUN eval/run-controlled.ts          # controlled scoring
bash eval/scripts/clone-wild.sh                          # fetch wild repos (gitignored)
TS_NODE_PROJECT=$TS $RUN eval/run-wild.ts                # wild scan
TS_NODE_PROJECT=$TS $RUN eval/run-headline.ts            # headline stats

# baselines (SkillSpector installed separately; see VERSIONS.md):
SKILLSPECTOR_BIN=/path/to/skillspector TS_NODE_PROJECT=$TS $RUN eval/run-baselines.ts
SKILLSPECTOR_BIN=/path/to/skillspector TS_NODE_PROJECT=$TS $RUN eval/run-baselines-wild.ts

TS_NODE_PROJECT=$TS $RUN eval/generate-tables.ts         # LaTeX tables
```
Each script is independent, writes one JSON to `results/`, and fails soft (a bad
repo is logged and skipped, never crashes the run). All times are seconds (1 dp).

## SkillSpector baseline
Install once: `git clone https://github.com/NVIDIA/SkillSpector` (or fetch the
tarball), then `uv venv .venv && uv sync`. The binary is `.venv/bin/skillspector`.
SkillSpector is skill/file-level; for repo-level cross-file/MCP/memory cases the
controlled harness records `out_of_scope` rather than scoring it zero. On large
wild repos its OSV dependency lookups make it slow (and it timed out on 18/37 in
this environment) — those are recorded as errors, not silently dropped.

## Determinism
PromptSonar runs are deterministic (`run-headline` and tables reproduce exactly
from the same `results/`). Verify with `eval/run-controlled.ts` re-runs or the
core determinism test.
