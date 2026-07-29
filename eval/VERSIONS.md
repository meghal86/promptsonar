# Evaluation Tool Versions

Pinned versions for the AISec 2026 PromptSonar evaluation. The pipeline is
deterministic and makes **zero LLM calls** in PromptSonar; the only optional
LLM path (SkillSpector +LLM) was intentionally **not run** (see CONSTRAINTS).

Generated: 2026-06-30 (UTC); wild-corpus results regenerated 2026-07-11 at the eval-ready commit on git-cloned (depth-1) snapshots

## Core
| Component | Version / ref |
|---|---|
| Node.js | v22.22.2 |
| PromptSonar (this repo) | commit `132c3c4` (`132c3c4a1109c8e44b3970d2cf65c0a965ff70b5`) — eval-ready (60% audited FP round) |
| PromptSonar CLI | 1.4.3 |
| ts-node | 10.9.2 |
| vitest | 4.1.7 |

## Baseline
| Component | Version / ref |
|---|---|
| NVIDIA SkillSpector | SkillSpector v2.3.7 — fetched from `NVIDIA/SkillSpector@main` via codeload on 2026-06-30 |
| uv | uv 0.8.17 |
| Python | Python 3.11.15 |
| SkillSpector mode | `scan --no-llm --format json` (deterministic; +LLM not run) |

## Not used
| Component | Status |
|---|---|
| garak | not used in this evaluation |

## Notes
- Environment blocks `git clone` and `api.github.com`; repos were fetched as
  depth-1 codeload tarballs (see `eval/scripts/clone-wild.sh`). Record the exact
  commit per repo with `git ls-remote` on an unrestricted host if needed.
- SkillSpector's OSV.dev CVE lookups return 403 behind the egress proxy; it
  falls back to bundled static data. This affects only dependency-CVE checks,
  not the skill/prompt analysis used in the comparison.
- Wild-corpus repo snapshots are pinned by branch (`default_branch` in
  `eval/corpus/wild/repos.json`) at fetch time; clones are gitignored.
