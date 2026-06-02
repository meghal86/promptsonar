# PromptSonar Real-World Example Library

This directory contains deterministic execution-path examples for PromptSonar.
Each case is a static fixture derived from the existing execution-path benchmark
and workflow engines. The library does not introduce scanner logic, runtime
logic, external calls, or mock detections.

Every case includes:

- `vulnerable.prompt` or `vulnerable.config.json`
- `expected.json`
- `remediated.prompt` or `remediated.config.json`

The `expected.json` contract records expected findings, execution path,
provenance evidence, confidence, root cause, workflow replay, workflow diff, and
expected risk reduction.

