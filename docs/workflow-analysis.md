# AI Workflow Security Analysis

PromptSonar includes a deterministic workflow analysis pass that annotates findings with a lightweight graph when a risky AI workflow path can be inferred from static evidence.

Workflow analysis is not a runtime exploit check. It does not call an LLM, execute tools, confirm reachability, or prove exploitation. It only records conservative static-analysis paths where untrusted content appears able to influence privileged AI workflow components.

## Trust Boundaries

A trust boundary is crossed when untrusted content flows into trusted or privileged workflow components.

Supported trust labels:

- `trusted`
- `untrusted`
- `privileged`
- `unknown`

Privileged sinks include tool execution, shell execution, filesystem access, network access, secrets, system prompts, and developer prompts.

## Node Types

Supported workflow node types:

- `user_input`
- `system_prompt`
- `developer_prompt`
- `prompt_template`
- `agent_memory`
- `rag_context`
- `mcp_server`
- `mcp_tool`
- `tool_router`
- `tool_execution`
- `shell_execution`
- `network_access`
- `filesystem_access`
- `secret`
- `unknown`

## Edge Types

Supported workflow edge types:

- `data_flow`
- `instruction_flow`
- `retrieval_flow`
- `memory_flow`
- `tool_call`
- `permission_flow`
- `execution_flow`

## Dangerous Flow Examples

Prompt injection near tool routing:

```text
user_input -> prompt_template -> tool_router -> shell_execution
```

RAG content affecting instructions:

```text
rag_context -> prompt_template -> system_prompt
```

Untrusted memory influencing tool selection:

```text
user_input -> agent_memory -> tool_router
```

MCP server exposing privileged execution:

```text
mcp_server -> mcp_tool -> shell_execution
```

## Output Shape

When a path is inferred, PromptSonar adds optional `finding.workflow` data. Existing JSON consumers can ignore this field.

```json
{
  "source": "user_input",
  "sink": "shell_execution",
  "trustBoundaryCrossed": true,
  "privilegedSinkReached": true,
  "risk": "high"
}
```

SARIF output stores the compact workflow summary under `result.properties.workflow`.

## Detection Scope

PromptSonar looks for workflow-relevant evidence in common AI workflow locations:

- `prompts/**`
- `agents/**`
- `ai/**`
- `rag/**`
- `mcp.json`
- `.vscode/mcp.json`
- `*.prompt.*`

## Limitations & Non-Runtime Guarantees

As a deterministic, local-first static analysis security auditor, PromptSonar operates under specific boundaries to empower developers with immediate feedback at the IDE, CLI, or CI pipeline layer. It is not a substitute for runtime sandboxing or dynamic testing.

### 1. Static-Analysis Boundaries vs. Dynamic Realities
- **No LLM or ML Calls**: PromptSonar is 100% deterministic and runs entirely locally. It does not send prompts to third-party APIs or execute machine learning models. While this guarantees absolute privacy, speed, and zero cost, it means PromptSonar does not evaluate semantic contexts in the way a live model would.
- **Pattern Matching Boundaries**: We employ a sophisticated regex-based and structural parsing engine. It is highly optimized to detect homoglyphs, evasion techniques, and sensitive credentials (e.g. OpenAI keys), but it can be bypassed by extremely creative, unique, or obfuscated command inputs.
- **Non-Runtime Guarantees**: PromptSonar scans files statically. It cannot verify whether an endpoint is live, whether a tool route actually resolves at runtime, or whether an agent framework has additional dynamic guardrails in place that block an exploit before execution.

### 2. Workflow Inference Limitations
- **Conservative Heuristics**: Our multi-hop workflow inference uses static evidence clues within prompt files to construct directional paths (e.g. RAG -> agent memory -> tool router). If a prompt does not explicitly describe its data sources or downstream sinks, the analyzer will not infer a workflow.
- **Framework Agnosticism**: We support general agent, RAG, and MCP patterns, but do not model custom, runtime-specific routing logic of individual frameworks (such as LangChain, AutoGen, or LlamaIndex) unless they express their boundaries in scanned files (such as MCP configurations).
- **Absence is not Safety**: The lack of a workflow warning or rule violation from PromptSonar does NOT guarantee that a prompt is secure. It only indicates that no known static vulnerabilities or privilege escalation structures were detected.

### 3. False-Positive & Calibration Expectations
- **High-Recall Design**: Our rules are calibrated to err on the side of safety (high recall), which can occasionally trigger alerts on educational snippets, harmless documentation examples, or toy code.
- **Calm Suppression Controls**: Developers should proactively use waiver configurations (`.promptsonar-waivers.yaml`) to suppress benign warnings in their repositories rather than reducing rule strictness, preserving deterministic coverage for true hazards.
