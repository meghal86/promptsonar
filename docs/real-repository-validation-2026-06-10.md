# Real Repository Validation - 2026-06-10

## Method

The current PromptSonar CLI package (`1.4.3`) generated
`RepositoryExecutionReport` version `1.5.0` for ten public repositories at the
pinned commits below. Each scan used the canonical repository JSON report:

```bash
promptsonar repo <checkout> --json --output <report.json>
```

The review measured:

- issue quality through manual review of each repository's ten
  severity-ranked issues;
- execution path quality using `pathValidation`, graph node and edge
  references, and high-risk path evidence;
- likely false positives through source review of those 100 issues;
- fix usefulness by checking both fix contract completeness and whether the
  suggested fix applied to the cited source context;
- impacted file accuracy by reconciling `impactedFiles` against issue and
  evidence file references.

“Likely false or non-actionable” is a manual static-analysis assessment, not a
claim that the repository is vulnerability-free.

## Aggregate Findings

| Measure | Result |
| --- | ---: |
| Repositories scanned | 10 |
| Issues | 31,864 |
| Critical / high issues | 240 / 2,512 |
| Impacted files | 3,430 |
| Reachable paths | 3,512 |
| Graph-backed paths with valid node/edge references | 886 |
| Paths without a node sequence | 2,626 |
| Path validation errors | 5,252 |
| High/critical paths with evidence | 100% |
| Reports passing path validation | 0 / 10 |
| Top issues manually reviewed | 100 |
| Review-worthy top issues | 13 / 100 |
| Likely false or non-actionable top issues | 87 / 100 |
| Context-useful fixes in reviewed top issues | 10 / 100 |
| High/critical issues with complete fix fields | 100% |
| Impacted-file indexes matching issue counts | 10 / 10 |
| Issues represented by an impacted evidence file | 100% |

### What Worked

- The scanner consistently found relevant surface types: agent instructions,
  prompts, skills, MCP configuration, workflows, memory systems, and tool
  implementations.
- The canonical report contract was complete. High and critical issues had
  evidence, impacted files, quick fixes, recommended fixes, safe patterns, and
  effort estimates.
- `impactedFiles` bookkeeping was exact in all reports: index size, unique
  issue files, and per-file issue counts reconciled.
- All 886 graph-backed reachable paths referenced existing execution-map nodes
  and edges.

### What Was Confusing

- Trust status was often determined by documentation, tests, placeholders,
  imports, docstrings, or encoding markers rather than an executable AI path.
- Every report failed its own path validation. The 2,626 workflow-derived
  paths without node sequences each produced `invalid-source` and
  `invalid-sensitive-action` errors.
- Evidence snippets were usually present in the cited file, but exact
  snippet-to-line agreement ranged from 89.6% to 100%. Repeated content could
  be assigned to a later, unrelated occurrence.
- Generic fixes were contract-complete but frequently did not fit the cited
  context. Examples include rotating credentials for placeholder variable
  names and adding human approval to documentation code blocks.

### Improvements Needed

- Distinguish executable prompt content from source scaffolding,
  documentation, tests, placeholders, imports, and docstrings before assigning
  security severity.
- Do not promote paths without graph nodes into canonical reachable paths.
- Bind evidence lines to the exact matched occurrence.
- Make fixes rule- and context-specific, especially for MCP configuration,
  secret references, examples, tests, and documentation.
- Treat a UTF-8 byte-order mark as file encoding metadata rather than a
  zero-width prompt injection.

## Repository Findings

### modelcontextprotocol/servers

Commit: `275175cda17ca9c49920ceed2bcf27e12e59f8b2`

Results: 19 files, 99 issues, 17 impacted files, 106 paths. The top-ten review
found 3 review-worthy items and 7 likely false or non-actionable items. Three
fixes were context-useful. One hundred paths were graph-backed; six had no node
sequence.

What worked: PromptSonar identified real MCP prompt registrations, tool
descriptions, and agent instructions without escalating any issue to high or
critical.

What was confusing: imports and README code fences were cited as missing
format enforcement. A memory README produced a path to external API access.

Improvements needed: extract the registered prompt or tool-description span,
lower generic structure findings around ordinary source, and avoid deriving
sensitive paths from README links and install examples.

### upstash/context7

Commit: `cc011a470743a38839a9fd54ff160a26d7680240`

Results: 17 files, 315 issues, 51 impacted files, 114 paths. The top-ten review
found 2 review-worthy items and 8 likely false or non-actionable items. No
reviewed fix was directly applicable without reinterpretation. Seventy-two
paths were graph-backed; 42 had no node sequence.

What worked: PromptSonar found the real remote MCP configuration, skills, and
agent source.

What was confusing: setup documentation containing shell examples became
critical tool-poisoning and workflow-escalation issues. An environment-variable
API key reference was treated as exposed sensitive data.

Improvements needed: provide MCP-config-specific fixes, distinguish secret
values from environment-variable references, and prevent setup documentation
from receiving executable-path severity.

### browser-use/browser-use

Commit: `476ef1b3b231ff950ecde26a33b61a112d16558f`

Results: 89 files, 1,421 issues, 190 impacted files, 244 paths. The top-ten
review found 1 review-worthy item and 9 likely false or non-actionable items.
No reviewed fix was context-useful. Ninety-eight paths were graph-backed; 146
had no node sequence.

What worked: PromptSonar recognized the repository's agent instructions,
skills, and browser-agent implementation as relevant AI surfaces.

What was confusing: Pydantic imports and coding guidance were classified as
critical prompt injection. A normal light-bulb emoji was reported as Unicode
obfuscation, and API key documentation was treated as a secret disclosure.

Improvements needed: scan the extracted instruction span rather than nearby
imports, distinguish key references from values, and exclude ordinary emoji
from obfuscation findings.

### gpt-engineer-org/gpt-engineer

Commit: `a90fcd543eedcc0ff2c34561bc0785d2ba83c47e`

Results: 9 files, 286 issues, 26 impacted files, 29 paths. None of the reviewed
top ten was actionable in the cited context. Sixteen paths were graph-backed;
13 had no node sequence.

What worked: PromptSonar found code that performs destructive file operations
and prompt-oriented application modules.

What was confusing: an offline benchmark cleanup script was treated as an
AI-controlled unbounded-access path. Ordinary Python docstrings were treated
as prompt content.

Improvements needed: require a prompt, agent, or tool-routing relationship
before escalating privileged operations, and separate maintenance scripts and
API docstrings from runtime instructions.

### FlowiseAI/Flowise

Commit: `f4e2794f6a576b94578f2fdafbf49c2fb304626c`

Results: 517 files, 3,189 issues, 426 impacted files, 423 paths. The top-ten
review found 2 review-worthy items and 8 likely false or non-actionable items.
Two fixes were context-useful. One hundred paths were graph-backed; 323 had no
node sequence.

What worked: PromptSonar identified a user-configurable system-prompt override
and a prompt-chaining template that incorporates prior execution output.

What was confusing: injection test fixtures and moderation deny-list examples
were reported as active critical injection. Redacted or placeholder API keys
were reported as exposed credentials.

Improvements needed: recognize negative test and moderation patterns, treat
redacted placeholders as non-secrets, and preserve the useful prompt-chaining
signal without allowing fixtures to dominate trust status.

### mendableai/firecrawl

Commit: `649c13a33e1a35b460edf646effe3d0b806da62a`

Results: 92 files, 1,365 issues, 153 impacted files, 197 paths. The top-ten
review found 2 review-worthy items and 8 likely false or non-actionable items.
Two fixes were context-useful. One hundred paths were graph-backed; 97 had no
node sequence.

What worked: PromptSonar found an API capable of executing browser-session
code or natural-language instructions, which is a legitimate privileged
surface for review.

What was confusing: error messages naming an API-key environment variable were
reported as critical credential exposure. Test URLs, SDK docstrings, blog code
blocks, and contribution instructions dominated high-severity results.

Improvements needed: distinguish secret names from values, reduce test and
documentation severity, and tie privileged findings to the callable execution
boundary rather than its docstring.

### mem0ai/mem0

Commit: `2274b5acadf44a2f27e9f1fed6787f1dbe73a3d6`

Results: 214 files, 2,371 issues, 263 impacted files, 330 paths. None of the
reviewed top ten was actionable in the cited context. One hundred paths were
graph-backed; 230 had no node sequence.

What worked: PromptSonar found real memory prompts, project instructions,
skills, and persistence surfaces.

What was confusing: API method docstrings such as “Delete specific entities”
and Pydantic imports were classified as critical prompt injection. Optional
`api_key` configuration fields were treated as disclosed credentials.

Improvements needed: distinguish implementation APIs from model instructions,
differentiate secret-bearing literals from configuration schemas, and
prioritize the actual memory extraction prompt over surrounding client code.

### deepset-ai/haystack

Commit: `2d1f229f016cb74a3e9098d27256352e71f3fe79`

Results: 403 files, 17,281 issues, 1,348 impacted files, 1,321 paths. All ten
reviewed top issues were false positives. One hundred paths were graph-backed;
1,221 had no node sequence.

What worked: PromptSonar found a broad set of integration and tool
documentation associated with model and external API usage.

What was confusing: 1,838 high/critical PII findings were generated, led by
documentation headings that say “API Key Authentication.” Versioned copies of
the same documentation amplified the result. Exact evidence-line agreement was
the lowest in the sample at 89.6%.

Improvements needed: require secret-like values for credential exposure,
collapse versioned documentation duplicates, and bind evidence to the exact
matched occurrence.

### microsoft/semantic-kernel

Commit: `61331d834d4b8f5743064de7cf35472199ed61b4`

Results: 671 files, 3,474 issues, 620 impacted files, 464 paths. All ten
reviewed top issues were false positives. One hundred paths were graph-backed;
364 had no node sequence.

What worked: PromptSonar covered a large cross-language agent codebase and
produced internally consistent impacted-file counts.

What was confusing: 402 high/critical zero-width injection findings were
caused by the UTF-8 byte-order mark (`EF BB BF`) at the beginning of C# files.
The issue evidence displayed normal source text instead of the encoding marker.

Improvements needed: strip or classify a leading byte-order mark before
zero-width analysis and show the exact invisible code point when a real
obfuscation finding exists.

### microsoft/autogen

Commit: `027ecf0a379bcc1d09956d46d12d44a3ad9cee14`

Results: 232 files, 2,063 issues, 336 impacted files, 284 paths. The top-ten
review found 3 review-worthy items and 7 likely false or non-actionable items.
Three fixes were context-useful. One hundred paths were graph-backed; 184 had
no node sequence.

What worked: PromptSonar identified real task-centric memory, user-provided
guidance persistence, vector memory, and model-client surfaces.

What was confusing: Pydantic imports and class docstrings were classified as
critical injection or privileged execution. A ChromaDB import was reported as
a hardcoded credit card.

Improvements needed: preserve memory-persistence findings while narrowing
detection to actual data flow, and require evidence matching the reported
secret type before assigning critical severity.
