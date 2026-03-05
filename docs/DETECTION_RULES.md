# PromptSonar — Detection Rules & Analysis Reference

> **Last updated:** March 5, 2026 — v1.0.13 (Phase 1 complete)

PromptSonar detects LLM prompts in source code and evaluates them against a comprehensive rule engine covering security, clarity, structure, best practices, consistency, efficiency, and ethics.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prompt Detection (Parser)](#prompt-detection-parser)
3. [Analysis Rules](#analysis-rules)
   - [Security — OWASP Injection Patterns](#1-security--owasp-injection-patterns-sec_owasp_llm01_injection)
   - [Security — PII / Sensitive Data](#2-security--pii--sensitive-data-sec_owasp_llm02_pii)
   - [Security — Unbounded Persona](#3-security--unbounded-persona-sec_unbounded_persona)
   - [Security — Unbounded Access](#4-security--unbounded-access-sec_unbounded_access)
   - [Security — RAG Injection](#5-security--rag-injection-sec_rag_injection)
   - [Clarity](#6-clarity)
   - [Structure](#7-structure)
   - [Best Practices](#8-best-practices)
   - [Consistency](#9-consistency)
   - [Efficiency / Token Limits](#10-efficiency--token-limits)
   - [Ethics](#11-ethics)
4. [Scoring Model](#scoring-model)
5. [Output Formats](#output-formats)
6. [CLI](#cli)
7. [Waiver System](#waiver-system)
8. [Optimizer / Cost Savings](#optimizer--cost-savings)

---

## Architecture Overview

```
Source Code → Parser (Tree-sitter + Regex) → Detected Prompts → Rule Engine → Score + Findings (SARIF)
                                                                    ↓
                                                              Optimizer (LLMLingua-2) → ROI Cost Report
```

| Component | Path |
|---|---|
| Parser | `packages/core/src/parser/` |
| Rules Engine | `packages/core/src/rules/` |
| Tree-sitter Queries | `packages/core/queries/*.scm` |
| SARIF Formatter | `packages/core/src/formatter/sarif.ts` |
| Optimizer | `packages/core/src/optimizer/` |
| Default Config | `config/default-promptsonar.config.yaml` |

---

## Prompt Detection (Parser)

The parser identifies prompts using a multi-strategy approach in [`packages/core/src/parser/index.ts`](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/parser/index.ts).

### Supported Languages

| Language | Extensions | Tree-sitter Query |
|---|---|---|
| TypeScript / JavaScript | `.ts`, `.js`, `.tsx`, `.jsx` | `queries/typescript.scm` |
| Python | `.py` | `queries/python.scm` |
| Rust | `.rs` | `queries/rust.scm` |
| Java | `.java` | `queries/java.scm` |
| Go | `.go` | `queries/go.scm` |
| C# | `.cs` | `queries/c_sharp.scm` |

### Detection Strategies

Each detected prompt is classified by a `sourceType`:

| Source Type | Strategy | Description |
|---|---|---|
| `full_file` | Extension match | Files with `.prompt`, `.ai`, `.chat` extensions are treated as prompts in their entirety |
| `config_file` | Regex + keyword scan | JSON/YAML/GitHub Actions configs are scanned for prompt-related keys (`system`, `user`, `messages`, `prompt`, `instruction`) |
| `string_literal` | Tree-sitter AST query | String/template literals containing prompt keywords (≥20 chars, contains spaces) |
| `named_variable` | Tree-sitter AST query | Strings assigned to variables whose names match `/[Pp]rompt\|[Ii]nstruction\|[Mm]essage/` (TypeScript/Python only) |
| `framework_call` | Tree-sitter AST query | Calls to `PromptTemplate.from_template()`, `ChatPromptTemplate.fromMessages()`, or OpenAI `role: "system"` message dicts |
| `fallback_regex` | Regex fallback | Triple-quoted/backtick strings with prompt keywords — used when no tree-sitter grammar is available |

### Keyword Heuristic (`containsPromptKeyword`)

A string must meet **all** of these criteria to be recognized as a prompt:
- ≥ 20 characters long
- Contains at least one whitespace character
- **Plus** one of:
  - Contains an explicit LLM phrase (`"you are a"`, `"act as"`, `"ignore previous"`, `"system prompt"`, `"developer mode"`, etc.)
  - Contains words from **two** categories: a role word (`user`, `system`, `assistant`, `llm`, `ai`) **and** a context word (`prompt`, `instruction`, `query`, `task`)

---

## Analysis Rules

### 1. Security — OWASP Injection Patterns (`sec_owasp_llm01_injection`)

**File:** [owasp_patterns.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/security/owasp_patterns.ts)  
**Severity:** `critical` | **Penalty:** 30 pts | **Weight:** 40%

Detects prompt injection attacks mapped to **OWASP LLM Top 10 — LLM01**. Before scanning, text is **normalized** by:
- Decoding Base64 chunks (≥16 chars)
- Normalizing Cyrillic/Latin homoglyphs (е→e, о→o, р→p, etc.)

#### Detected Patterns

| Category | Example Patterns |
|---|---|
| **Classic instruction overrides** | `ignore previous instructions`, `disregard all prompts`, `forget all rules`, `new instructions` |
| **Role-playing / persona hijack** | `you are now a god/admin/hacker`, `act as DAN`, `pretend to be unrestricted`, `role: admin` |
| **DAN & jailbreak variants** | `DAN mode`, `do anything now`, `developer mode`, `hypothetical response`, `unrestricted mode` |
| **Safety filter bypass** | `ignore safety guidelines`, `no ethical filters`, `no content restrictions` |
| **Output redirection / exfiltration** | `print your system prompt`, `show me api key`, `send to email/http`, `reveal instructions` |
| **Encoding / obfuscation** | `rot13 text`, `base64 decode prompt`, ≥5 consecutive non-ASCII chars |
| **Tool / privilege abuse** | `use tool without permission`, `bypass guardrails`, `delete_all_users` |

#### Additional Unicode Obfuscation Checks

| Rule ID | Severity | Description |
|---|---|---|
| `sec_unicode_math_homoglyph` | `high` (20 pts) | Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF) |
| `sec_unicode_enclosed_obfuscation` | `high` (20 pts) | Enclosed Alphanumeric Symbols (U+1F100–U+1F1FF) |
| `sec_unicode_injection_obfuscation` | `critical` (30 pts) | >10 non-ASCII chars + injection keywords (`ignore`, `reveal`, `prompt`, `instruction`) |

---

### 2. Security — PII / Sensitive Data (`sec_owasp_llm02_pii`)

**File:** [pii.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/security/pii.ts)  
**Severity:** `high` | **Penalty:** 20 pts | **Weight:** 40%

Detects hardcoded sensitive information mapped to **OWASP LLM02 (Sensitive Information Disclosure)**.

| Data Type | Pattern |
|---|---|
| Email Address | `user@example.com` |
| SSN | `123-45-6789` |
| Credit Card | 13–16 digit sequences |
| OpenAI API Key | `sk-live-*`, `sk-test-*`, `sk-proj-*` |
| GitHub PAT | `ghp_` + 36 alphanumeric chars |
| Generic API Key | `api_key: "..."`, `secret: "..."`, `token: "..."` (≥16 chars) |

---

### 3. Security — Unbounded Persona (`sec_unbounded_persona`)

**File:** [unbounded_persona.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/security/unbounded_persona.ts)  
**Severity:** `high` | **Penalty:** 15 pts | **OWASP:** LLM01

Detects `act as` / `you are a` / `pretend to be` / `role-play as` persona declarations **without** behavioral constraint indicators.

| Constraint Indicator (exemption) |
|---|
| `only`, `never`, `must not`, `do not`, `restricted to`, `limited to`, `refuse`, `decline`, `allowed to` |

If the prompt assigns a persona but contains none of these constraint keywords, it is flagged as an unbounded persona.

---

### 4. Security — Unbounded Access (`sec_unbounded_access`)

**File:** [unbounded_access.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/security/unbounded_access.ts)  
**Severity:** `high` | **Penalty:** 15 pts | **OWASP:** LLM07

Detects prompts granting unrestricted system/DB/file access.

| Access Pattern |
|---|
| `access all files`, `read any file`, `entire database`, `full system access` |
| `execute any command`, `run any script`, `admin privileges`, `root access` |
| `unrestricted access`, `access everything`, `all permissions` |

Scope-limited prompts are exempted if they contain: `only from`, `restricted to`, `limited to`, `specific`, `scoped`, `sandboxed`, `allowlist`.

---

### 5. Security — RAG Injection (`sec_rag_injection`)

**File:** [rag_injection.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/security/rag_injection.ts)  
**Severity:** `high` | **Penalty:** 15 pts | **OWASP:** LLM07

Detects raw user input passed directly into retrieval/tool operations without validation.

| Retrieval Pattern |
|---|
| `search.*{user`, `query.*{user`, `retrieve.*{input`, `lookup.*{user` |
| `knowledge.*{user`, `database.*{input`, `fetch.*{user`, `find.*{input` |

Exempted when sanitization indicators are present: `sanitize`, `validate`, `escape`, `filter`, `clean`, `whitelist`.

---

### 6. Clarity

**File:** [clarity.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/clarity.ts)  
**Weight:** 15%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `clarity_missing_quantifier` | `medium` | 10 | Prompt implies a list/count (`"how many"`, `"list"`, `"give me"`) but lacks a quantifier (`"top 5"`, `"maximum 10"`, `"at least"`) |
| `clarity_open_ended` | `low` | 5 | Contains open-ended phrases: `"what do you think"`, `"anything else"`, `"tell me about"`, `"can you write"` |
| `clarity_vague_words` | `low` | 5 | Contains vague words: `try`, `maybe`, `perhaps`, `several`, `some`, `good` |

---

### 7. Structure

**File:** [structure.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/structure.ts)  
**Weight:** 15%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `struct_missing_format_enforcer` | `medium` | 15 | Prompt expects data output (`"format"`, `"schema"`, `"output"`, `"generate a"`, `"return"`, `"provide"`) but lacks format specification (`JSON`, `YAML`, `XML`, `markdown`, `CSV`, code fences) |

---

### 8. Best Practices

**File:** [best_practices.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/best_practices.ts)  
**Weight:** 15%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `bp_missing_persona` | `low` | 5 | Missing role/persona setup (`"you are a"`, `"act as"`, `"role:"`, `"persona:"`) |
| `bp_missing_few_shot` | `low` | 5 | Missing few-shot examples (`"example:"`, `"for example"`, `"input:"`, `"output:"`) |
| `bp_missing_cot` | `low` | 5 | Complex prompt (>100 chars) without Chain-of-Thought (`"think step by step"`, `"step-by-step"`, `"explain your reasoning"`) |

---

### 9. Consistency

**File:** [consistency.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/consistency.ts)  
**Weight:** 10%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `consist_contradiction` | `medium` | 10 | Contradicting instructions found in the same prompt |

**Detected contradiction pairs:**

| Instruction A | Instruction B |
|---|---|
| `be concise` | `be detailed` |
| `short response` | `comprehensive explanation` |
| `only return` | `also include` |
| `simple language` | `highly technical` |
| `brief summary` | `exhaustive list` |
| `highly detailed` | `concise` |
| `detailed` | `short` |

---

### 10. Efficiency / Token Limits

**File:** [token_limit.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/efficiency/token_limit.ts)  
**Weight:** 5%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `eff_token_budget` | `medium` | 15 | Estimated tokens (≈ chars ÷ 4) exceed the configured budget (default: 8192) |
| `eff_token_bloat` | `high` | 20 | Prompt exceeds 8,000 characters (~2,000 tokens) — risk of truncation/high cost |
| `eff_compression_potential` | `low` | 5 | Prompt has >100 words — high compression potential (>40%) |

---

### 11. Ethics

**File:** [ethics.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/ethics.ts)  
**Weight:** 5%

| Rule ID | Severity | Penalty | Trigger |
|---|---|---|---|
| `ethics_bias_indicator` | `high` | 15 | Prompt contains bias-indicating phrases: `always assume`, `never trust`, `those people`, `typical of`, `inherently`, `naturally better`, `inferior`, `superior race` |
| `ethics_manipulation` | `high` | 15 | Prompt contains manipulation patterns: `manipulate the user`, `trick them`, `deceive`, `secretly`, `without.*consent`, `coerce`, `gaslight`, `exploit` |

---

## Scoring Model

**File:** [rules/index.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/rules/index.ts)

### Weighted Category Formula

| Category | Weight |
|---|---|
| Security | 40% |
| Clarity | 15% |
| Structure | 15% |
| Best Practices | 15% |
| Consistency | 5% |
| Efficiency | 5% |
| Ethics | 5% |

```
Score = max(0, min(100, 100 − Σ(penalty × category_weight)))
```

### Status Thresholds

| Score | Status |
|---|---|
| ≥ 85 | ✅ `pass` |
| 70–84 | ⚠️ `warn` |
| < 70 | ❌ `fail` |

> **Critical Override:** If any finding has `severity: "critical"`, the score is hard-capped at **49** and status is forced to `fail`.

---

## Output Formats

### SARIF (Static Analysis Results Interchange Format)

**File:** [formatter/sarif.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/formatter/sarif.ts)

Findings are exported as SARIF v2.1.0 for CI/CD integration (GitHub Code Scanning, etc.).

| SARIF Level | PromptSonar Severity |
|---|---|
| `error` | `critical`, `high` |
| `warning` | `medium` |
| `note` | `low` |

---

## CLI

**Package:** [`packages/cli/`](file:///Users/meghalparikh/Downloads/promptsonar/packages/cli/)  
**Entry:** [`packages/cli/src/cli.ts`](file:///Users/meghalparikh/Downloads/promptsonar/packages/cli/src/cli.ts)

### Usage

```bash
promptsonar scan <path> [options]
```

| Flag | Description | Default |
|---|---|---|
| `--json` | Output as JSON | — |
| `--sarif` | Output as SARIF v2.1.0 | — |
| `--output <file>` | Write to file instead of stdout | — |
| `--fail-on <severity>` | Exit code threshold | `critical` |
| `--waiver-file <file>` | Waiver YAML path | `.promptsonar-waivers.yaml` |
| `--diff-only` | Scan changed files only | — |
| `--verbose` | Show skipped files | — |

### Exit Codes

| Code | Meaning |
|---|---|
| `0` | Clean — no findings at or above threshold |
| `1` | Critical finding(s) detected |
| `2` | High finding(s) detected (no criticals) |
| `3` | Medium finding(s) detected (no criticals/highs) |

---

## Waiver System

**File:** [`packages/core/src/waiver.ts`](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/waiver.ts)

External `.promptsonar-waivers.yaml` file with Zod-validated schema.

### Waiver Schema

```yaml
waivers:
  - id: "WVR-2026-001"          # Format: WVR-YYYY-NNN
    status: active               # active | expired | revoked
    scope:
      rule_id: "bp_missing_cot"  # ONE of: rule_id, path, prompt_id
    justification: "Intentionally omitting CoT for this use case because..."
    ticket_url: "https://jira.example.com/PROJ-123"  # optional
    expires_at: "2027-01-01"     # YYYY-MM-DD
    owner: "meghal"              # optional
```

Waived findings show `"waived": true` in JSON output and are excluded from exit code calculation.

---

## Optimizer / Cost Savings

### LLMLingua-2 Compression

**File:** [optimizer/llmlingua.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/optimizer/llmlingua.ts)

Uses `microsoft/llmlingua-2-xlm-roberta-large-meetingbank` model to compress prompt tokens with a target of **20% minimum reduction**. Falls back to a simulated 22% reduction if the Python dependency is unavailable.

### ROI Cost Calculator

**File:** [optimizer/costCalculator.ts](file:///Users/meghalparikh/Downloads/promptsonar/packages/core/src/optimizer/costCalculator.ts)

Estimates dollar savings based on:
- **Blended LLM cost:** $5.00 per 1M input tokens (GPT-4 Turbo / Claude 3 Opus average)
- **Output:** dollars saved per 10,000 API calls

---

## Rule Summary Table

| Rule ID | Category | Severity | Penalty | OWASP |
|---|---|---|---|---|
| `sec_owasp_llm01_injection` | Security | Critical | 30 | LLM01 |
| `sec_unicode_math_homoglyph` | Security | High | 20 | LLM01 |
| `sec_unicode_enclosed_obfuscation` | Security | High | 20 | LLM01 |
| `sec_unicode_injection_obfuscation` | Security | Critical | 30 | LLM01 |
| `sec_owasp_llm02_pii` | Security | High | 20 | LLM02 |
| `sec_unbounded_persona` | Security | High | 15 | LLM01 |
| `sec_unbounded_access` | Security | High | 15 | LLM07 |
| `sec_rag_injection` | Security | High | 15 | LLM07 |
| `clarity_missing_quantifier` | Clarity | Medium | 10 | — |
| `clarity_open_ended` | Clarity | Low | 5 | — |
| `clarity_vague_words` | Clarity | Low | 5 | — |
| `struct_missing_format_enforcer` | Structure | Medium | 15 | — |
| `bp_missing_persona` | Best Practices | Low | 5 | — |
| `bp_missing_few_shot` | Best Practices | Low | 5 | — |
| `bp_missing_cot` | Best Practices | Low | 5 | — |
| `consist_contradiction` | Consistency | Medium | 10 | — |
| `eff_token_budget` | Efficiency | Medium | 15 | — |
| `eff_token_bloat` | Efficiency | High | 20 | — |
| `eff_compression_potential` | Efficiency | Low | 5 | — |
| `ethics_bias_indicator` | Ethics | High | 15 | — |
| `ethics_manipulation` | Ethics | High | 15 | — |
