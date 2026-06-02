# PromptSonar Execution Path Benchmark

The execution-path benchmark is the canonical deterministic evaluation set for PromptSonar's AI execution-path security coverage.

It evaluates:

- Prompt Injection
- MCP Tool Poisoning
- Workflow Escalation
- Privileged Sink Access
- Memory Escalation
- Credential Exposure
- RAG Poisoning
- Tool Abuse

## Dataset Structure

- `cases.json` defines the benchmark manifest and expectations.
- `cases/*.prompt` contains the vulnerable prompt text for each case.
- `results/` is reserved for generated JSON or Markdown benchmark reports.

Each case declares:

- `expectedFindings`: rule IDs that must be detected.
- `expectedExecutionPath`: exact workflow node path expected from the workflow engine.
- `expectedRootCause`: rule ID expected from the root-cause grouping engine.
- `expectedConfidenceRange`: inclusive confidence score range expected from the provenance/confidence engine.
- `runtime`: optional runtime context for cases that need active tools, memory, MCP servers, or a planned operation.

## Runner

Run from the repository root after building the CLI:

```bash
promptsonar benchmark
```

Repository-local development usage:

```bash
node packages/cli/dist/cli.js benchmark
node packages/cli/dist/cli.js benchmark --format json
node packages/cli/dist/cli.js benchmark --format markdown --output benchmarks/execution-path/results/latest.md
```

## Scoring Algorithm

Each case receives four equally weighted scores:

- Findings accuracy: percentage of expected rule IDs present in actual findings.
- Execution path accuracy: exact match against the expected workflow node path.
- Root cause accuracy: exact match against the expected root-cause rule ID.
- Confidence accuracy: actual confidence score falls inside the expected inclusive range.

The case score is the average of those four dimensions. The benchmark score is the average of all case scores.

## Report Format

Terminal output includes:

- score
- pass rate
- findings accuracy
- execution path accuracy
- confidence accuracy
- per-case status

JSON and Markdown reports include the same summary plus expected/actual findings, execution paths, root causes, confidence, replay event counts, and diff risk-reduction metadata.

## Engine Reuse

The benchmark runner reuses existing PromptSonar engines:

- scanner rules through `evaluatePrompt`
- runtime review through `analyzeExecutionPath`
- workflow inference through attached finding workflows
- provenance and confidence through workflow metadata
- replay through `workflow_replay`
- diff through `workflow_diff`
- root cause through `analyzeRootCause`

No scanner logic is reimplemented by the benchmark suite.
