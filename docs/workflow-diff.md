# Workflow Diff Engine

The Workflow Diff Engine answers two questions a normal scanner cannot:

> **"What changed after remediation?"** and **"Did the fix actually remove the dangerous path?"**

For any finding whose inferred execution path reaches a **privileged sink**
(shell, filesystem, network, credentials, system prompt, …), PromptSonar attaches
a deterministic `workflow_diff`: the dangerous **before** graph, a hardened
**after** graph, exactly which nodes/edges were removed, and a risk-reduction
percentage.

There are **no AI calls and no randomness** — every value is derived structurally
from the two graphs.

---

## What `after` represents (v1 assumption)

The `after` graph produced by `deriveRemediatedGraph()` is a **derived safe-path
approximation**, not a rescanned hardened prompt:

- We do **not** re-run the scanner on a remediated artifact.
- We structurally strip the dangerous nodes/edges and substitute the canonical
  benign boundary: `USER INPUT → MODEL → RESPONSE`.
- It answers *"if these dangerous nodes were removed, what would the path look
  like?"* — useful as remediation **proof**, but it is a **model, not a
  measurement**.

Future versions (gated behind `workflow_diff_version`) may replace this with
**actual remediation scans**, **workflow replay** (re-infer the path from the
rewritten artifact), or **before/after validation**.

---

## Fields

| Field (model, camelCase) | SARIF key (snake_case) | Type | Meaning |
| --- | --- | --- | --- |
| `workflowDiffVersion` | `workflow_diff_version` | `string` | Schema version of the diff contract. Current: `"1.0"`. |
| `diffReason` | `diff_reason` | enum | Why the workflow changed (see below). |
| `riskReduction` | `risk_reduction` | `number` (0–100) | `(beforeRisk − afterRisk) / beforeRisk × 100`, rounded. |
| `beforeRisk` | `before_risk` | `number` (0–100) | Deterministic risk magnitude of the `before` graph. |
| `afterRisk` | `after_risk` | `number` (0–100) | Deterministic risk magnitude of the `after` graph. |
| `executionPathRemoved` | `execution_path_removed` | `boolean` | `true` when a privileged sink existed in `before` and none remains in `after`. |
| `removedNodes` | `removed_nodes` | `string[]` | Node types present in `before` but not `after`. |
| `addedNodes` | `added_nodes` | `string[]` | Node types present in `after` but not `before`. |
| `removedEdges` | `removed_edges` | `string[]` | Edges (`"from -> to"`) removed by remediation. |
| `addedEdges` | `added_edges` | `string[]` | Edges added by remediation. |
| `before` / `after` | `before_path` / `after_path` | graph / `string[]` | Full graphs in the model; node-type lists in SARIF. |
| `comparison.privilegedSinks.removed` | `removed_privileged_sinks` | `string[]` | Privileged sink node types removed. |
| `comparison.trustBoundaries.removed` | `trust_boundary_removed` | `boolean` | Whether an untrusted→privileged boundary was removed. |

`beforeRisk` and `afterRisk` are an explicit part of the contract: future
features (**Workflow Replay**, **Benchmark Suite**, **GitHub PR Review**) consume
them directly, so they remain present even when `riskReduction` is `0`.

### `diffReason` values

| Value | When |
| --- | --- |
| `privileged_sink_removed` | A privileged sink existed before and **none** remains after. |
| `partial_remediation` | A privileged sink was removed but **at least one** still remains. |
| `trust_boundary_removed` | An untrusted/unknown boundary node (e.g. `mcp_server`) was removed (no sink change). |
| `routing_surface_removed` | The tool-routing surface (`tool_router`) was removed (no sink change). |
| `no_change` | Nothing structural changed. |

---

## Risk scoring (deterministic)

`computeGraphRisk(nodes)` sums fixed per-sink weights, then adds a trust-boundary
and routing-surface contribution, clamped to `0–100`:

| Contribution | Weight |
| --- | --- |
| `shell_execution` | 55 |
| `credential_store` | 50 |
| `filesystem_access` / `network_access` / `system_prompt` | 45 |
| `external_api` | 40 |
| `privileged_tool` | 35 |
| `tool_execution` | 30 |
| untrusted **and** privileged node present (trust boundary) | +25 |
| `tool_router` / `mcp_server` / `mcp_tool` present | +15 |
| residual (benign path that still carries untrusted input) | 5 |

A critical `user_input → tool_router → shell_execution` path scores ~95
(`critical`); the benign `user_input → model → response` path scores ~5 (`low`).

---

## Example (SARIF `properties.workflow_diff`)

```json
{
  "workflow_diff_version": "1.0",
  "diff_reason": "privileged_sink_removed",
  "risk_reduction": 95,
  "before_risk": 100,
  "after_risk": 5,
  "execution_path_removed": true,
  "removed_nodes": ["mcp_server", "privileged_tool", "shell_execution", "filesystem_access"],
  "removed_edges": [
    "mcp_server -> privileged_tool",
    "privileged_tool -> shell_execution",
    "shell_execution -> filesystem_access"
  ],
  "added_nodes": ["user_input", "model", "response"],
  "added_edges": ["user_input -> model", "model -> response"],
  "before_path": ["mcp_server", "privileged_tool", "shell_execution", "filesystem_access"],
  "after_path": ["user_input", "model", "response"],
  "removed_privileged_sinks": ["privileged_tool", "shell_execution", "filesystem_access"],
  "trust_boundary_removed": true
}
```

---

## Backward compatibility

- `workflow_diff` is **additive** and **optional**. It is present only when a
  finding's path reaches a privileged sink; otherwise it is `undefined`.
- Existing scans, old SARIF reports, and legacy dashboards that do not read
  `workflow_diff` are unaffected. Dashboard rendering uses optional chaining and
  safe defaults, so a missing `workflow_diff` never crashes the UI.
- New shapes ship under a bumped `workflow_diff_version`; consumers should branch
  on it rather than assuming the `1.0` layout.

## API

```ts
import {
  computeGraphRisk,      // (nodes) -> { risk, riskScore }
  pathToGraph,           // (WorkflowPath) -> WorkflowGraph
  deriveRemediatedGraph, // (WorkflowGraph) -> hardened WorkflowGraph (v1 approximation)
  computeWorkflowDiff,   // (before, after) -> WorkflowDiff
  buildWorkflowDiff,     // (FindingWorkflow) -> WorkflowDiff
  WORKFLOW_DIFF_VERSION, // "1.0"
} from '@promptsonar/core';
```
