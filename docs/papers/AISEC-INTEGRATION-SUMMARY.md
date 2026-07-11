# AISec 2026 — Integration & Reconciliation Summary (for author review)

**Assembled paper:** `docs/papers/aisec2026.tex` (+ `table*.tex`, `references.bib`).
**Do not submit as-is.** This document lists every open decision, unverified
claim, and gap that still needs the author. Assembled on branch
`aisec2026-submission` (off the eval-ready commit `132c3c4`).

---

## 0. Decisions you made (applied)

- **Headline round = 60% FP (commit `132c3c4`), 8/20 TP.** The 65% round is now
  framed *honestly and correctly* in Limitations §6.3 as a **distinct fourth fix
  round** (not a "re-verification of the same state" — that draft framing was
  factually wrong and has been rewritten).
- **Committed results regenerated at `132c3c4`** on freshly git-cloned snapshots.
  `wild-results.json`, `headline-stats.json`, `paper-tables.md`, `VERSIONS.md`
  updated and committed. All paper numbers below are the regenerated values.

---

## 1. Reconciliation table (drafts → FINAL, regenerated)

| Quantity | In drafts | FINAL (regenerated @132c3c4) | Action taken |
|---|---|---|---|
| Total findings (wild) | 722 | **723** | updated |
| Execution paths | 1,398 | **1,414** | updated |
| Cross-file paths | 513 | **520** | updated |
| Severity split | — | 0/30/15/678 | added |
| Confidence split | — | 25/512/186 | added |
| **Repos w/ cross-file finding (the "[N]"/"19" claim)** | **19** | **17 (45.9%)** | **corrected everywhere** (Abstract, Related §2.2, Results §5.3) |
| Cross-file repos % | 51.4% | **45.9%** | corrected |
| Wild scan time (mean/med/max s) | placeholder | **10.9 / 6.6 / 38.7** | filled |
| Controlled scan time | placeholder | **0.4 / 0.2 / 1.6** | filled |
| Volume-drop claim | "72% (2,002→722)" | **64% (2,002→723)** | **corrected arithmetic** |
| Cross-file pre-audit→final | 2,923→513 | 2,923→**520** | updated |
| Controlled P/R/F1, TP/FP/FN, TN, paths | 1.00; 25/0/0; 4; 15 | same ✓ | verified match |
| Baseline (SkillSpector) controlled | 12; 4/0/5; 1.00/0.44/0.62 | same ✓ (`baseline-results.json`) | verified match |
| Audit rounds 85/90/70/60, TP 3/2/6/8 | as drafted | same ✓ | verified match |
| Confirmed-tier FP (final) | 38% | 3/8 = 37.5% ✓ | verified match |
| # audit rounds | "three" (Abstract/Results) vs "four" (Methods §4.6) | **4 fix rounds** (90/70/60/65) | **inconsistency — see D2** |
| "52 confirmed paths" (Limitations §6.3) | 52 | **not reproducible** in any results file (confirmed *findings* = 25) | **removed the specific figure — see C2** |
| eval commit (Methods §4.1, VERSIONS) | `edd87e9` (stale, pre-fix) | **`132c3c4`** | VERSIONS updated; paper hash anonymized |
| SkillSpector version | 2.3.7 (run) | current latest is v2.0.0 per web (numbering unclear) | verify — see C3 |
| Node.js | v22.22.2 | v22.22.2 ✓ | verified |

**Table 4 (cross-file gap) caveat:** the per-repo breakdown was regenerated from
the fresh 60%-engine per-repo counts (total **520**, 17 repos). The **SkillSpector
"per-file issues" context column was dropped** because `baseline-wild-results.json`
is stale (pre-audit, generated 2026-06-30) and a fresh SkillSpector run was not
performed. The load-bearing number (baseline cross-file = **0**, structural) is
unchanged. **Re-run `eval/run-baselines-wild.ts` at `132c3c4` for camera-ready** if
you want the per-file context column back (uv is installed; SkillSpector needs
reinstalling).

---

## 2. Placeholders filled (Step 2)

| Placeholder | Location | Value used |
|---|---|---|
| `[N]` repos | Abstract | **17** |
| `[INSERT: commit hash]` | Methods §4.1 | anonymized (hash `132c3c4` in VERSIONS, omitted in paper for double-blind) |
| `[CITATION]` SkillSpector | Methods §4.5 | `\cite{skillspector}` → GitHub repo + Liu et al. 2026 (in `references.bib`) |
| scan-time figures | Results Tables 2, 5 | filled (10.9/6.6/38.7; 0.4/0.2/1.6) |
| `Section 5.[X]` (auto_approve) | Limitations §6.1 | → §5.1 / Table 1 (controlled corpus covers approval states) |
| `Section [X]` (determinism) | Results §5.5 | → §4.4 |

---

## 3. Open decisions requiring YOUR judgment (not resolved here)

- **D1 — MISSING Section 3 (System Design). HIGH.** The five drafts are Abstract+Intro
  (§1), Related (§2), Methods (§4), Results (§5), Limitations (§6). **There is no
  §3** — yet every cross-reference assumes Methods=4/Results=5/Limitations=6, i.e.
  that §3 exists. A placeholder §3 is inserted to preserve numbering. You must author
  the System Design section (artifact discovery/classification, reference-verified
  edge construction, reachability, contextual verdict engine). `docs/papers/mcp-security-arxiv-draft.md`
  may be adaptable. **This is the single largest content gap.**
- **D2 — "three" vs "four" rounds.** Table 4 shows 3 headline fix rounds (85→60);
  Methods §4.6 says "four audit rounds"; there were in fact 4 *fix* rounds (the 4th =
  the 65% P1/P2 round). I set the paper to: **three headline rounds (Table 4) + a
  fourth discussed in §6.3**, and left Methods §4.6 saying "four audit rounds during
  development" (now consistent). Confirm you're happy with this framing, or
  standardize the wording.
- **A2 — Tool-name anonymization.** AISec 2026 **is double-blind** ("properly
  anonymized … no way to identify authors, including when linking code
  repositories"). I removed all GitHub URLs and commit hashes and put the tool name
  behind a `\sysname` macro (currently `PromptSonar`). **If the public repo makes
  "PromptSonar" discoverable/de-anonymizing, redefine `\sysname` to a neutral name**
  before submission. I defaulted to *keeping* the name for readability + flagging, per
  the "conservative + flag" instruction — but the conservative-most option is to
  rename; your call against the actual repo's public visibility.
- **Abstract framing.** The abstract still leads with audit/honesty as strongly as
  the technical claim (author note in draft). Unchanged — your rhetorical call.
- **Contribution 4 novelty.** "not aware of an equivalent benchmark" — softened to a
  footnote flagging it needs verification. Confirm or cite an equivalent.
- **§6.3 placement** (baseline-scope as Methods vs Limitations) and **§6 length** —
  unchanged; see §6 length note below.

---

## 4. Unverified claims / citations (Step 4 + citations)

**Competitor cross-file verification (Step 4):**

- **SkillSpector — claim HOLDS.** ✓ Verified via its README: "analyzes each artifact
  largely independently … no cross-artifact execution graphs or reference maps."
  Taint tracking (TT1–TT5) file-scope is *unspecified* in docs, so I softened nothing
  but note it. Cite: GitHub repo + "Liu et al., 2026, Agent Skills in the Wild."
- **⚠️ mcp-scan (Invariant Labs) — PARTIAL THREAT, claim SOFTENED.** mcp-scan **does**
  reason about **cross-server / "cross-origin" tool-shadowing** among multiple
  connected MCP servers at runtime. The draft's "evaluates each artifact
  independently" was **inaccurate for mcp-scan**. I **rewrote Related §2.2** to
  acknowledge mcp-scan's cross-server reasoning and sharpen the distinction: *runtime
  cross-server tool-shadowing* (mcp-scan) vs *static, repository-scale, reference-verified
  cross-file reachability* (this work). **Please read the revised §2.2 sentence — this
  is the most likely reviewer pushback point.**
- **garak, LLM Guard, NeMo Guardrails, Rebuff** — category claim (runtime/content-level,
  no repository/cross-file model) is consistent with their documentation; **not each
  individually re-verified for a new cross-file feature.** Low risk but flag.
- **Snyk agent-scan, Cisco IDE agent scanner** — mentioned generically in the draft;
  **NOT individually verified.** I kept the vague "largely follow the same
  artifact-level pattern" and did not add specific capability claims. If you want to
  name them specifically, verify first.
- **Semgrep** — cross-file taint on conventional code, no AI-artifact model: consistent
  with docs. **Sighthound removed** from the assembled draft (the draft note itself
  suggested dropping it as too new/low-adoption; Semgrep alone carries the SAST point).

**Citations (`references.bib`):** entries are `@misc` repo/paper references with
July-2026 access dates. **Items marked `VERIFY`** (garak arXiv id, NeMo Guardrails
EMNLP DOI, SkillSpector Liu et al. exact citation) must be confirmed against the
primary source — I did **not** invent identifiers.

---

## 5. CFP compliance (Steps 5–6)

Source: AISec 2026 CFP (aisec.cc), verified July 2026.

- **Format:** ACM `sigconf`. The `.tex` uses `\documentclass[sigconf,anonymous,review]{acmart}`.
  `acmart.cls` is **not vendored** (no network) — place it beside the `.tex` to compile.
- **Page limit:** **10 pages** double-column, **excluding** bibliography and
  well-marked appendices (up to **2** extra → **12 total max**).
- **⚠️ Page-count risk (Step 5).** I cannot compile here (no `acmart.cls`). Rough
  estimate: the assembled prose (§1,2,4,5,6) + 5 tables is already substantial and
  **§3 (System Design) and §7 (Conclusion) are not yet written.** Adding §3 (~1–1.5pp)
  will likely push toward or **over 10 pages**. Per your instruction I did **not** cut
  content to fit. **Most compressible if over: §6.1 and §6.3** (per your own draft
  note; keep §6.2, the differentiator, near full length). Decide after you add §3 and
  compile.
- **Double-blind:** **Yes** (confirmed). Applied: anonymous authors, `review`/`anonymous`
  class options, all GitHub URLs / commit hashes / author names removed, artifact
  referred to as "(anonymized)". See A2 for the tool-name decision.
- **GenAI-use disclosure:** **REQUIRED**, must be an explicit paragraph **after the
  references** (does **not** count toward page limit). **Inserted as a clearly-marked
  PLACEHOLDER** (`\section*{Disclosure of Generative-AI Use}`). **This is the single
  highest-priority remaining gap (G1)** — you must write it directly and honestly
  (what was AI-assisted: implementation, debugging, harness, audit passes; what was
  human-directed: architecture, root-cause prioritization, scope, all results
  verified against source). The scaffold in the `.tex` is a starting point ONLY.
- **Ethics / broader-impact:** the CFP's explicit hard requirement is the GenAI
  disclosure. A separate ethics/broader-impact statement was **not confirmed as
  mandatory** for AISec 2026 — **verify against the full CFP text.** Given the paper
  releases a scanner and a benchmark of real repositories, a short responsible-disclosure
  / intended-use note is advisable regardless; **not currently in the draft — flag.**

---

## 6. Required disclosures — status

| Item | Status |
|---|---|
| Generative-AI-use disclosure | **PLACEHOLDER inserted (G1, highest priority)** — author must write |
| Ethics / broader-impact statement | **Absent**; not confirmed mandatory — verify CFP + consider adding |
| Double-blind anonymization | Applied (URLs/hashes/names removed; tool name flagged, A2) |

---

## 7. What is NOT done / needs a human pass

1. **§3 System Design** — author it (D1).
2. **§7 Conclusion** — author it (placeholder present).
3. **GenAI disclosure paragraph** — write it (G1).
4. **Compile** with `acmart.cls` and check page count (Step 5).
5. **Tool-name anonymization** decision (A2).
6. **Verify** `references.bib` `VERIFY` items; **verify** Snyk/Cisco/garak/LLMGuard/
   NeMo/Rebuff current capabilities if named specifically.
7. **Re-run baseline-wild** at `132c3c4` for the Table 4 per-file context column
   (optional) and pin per-repo SHAs for camera-ready.
8. Re-read the **revised Related §2.2 mcp-scan sentence** (most likely reviewer
   pushback).

Nothing has been submitted. All changes are on branch `aisec2026-submission`.
