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

## Limitations

- No ML or LLM calls are used.
- Paths are omitted when source or sink cannot be inferred.
- Static findings are signals for review, not confirmed vulnerabilities.
- The graph does not model every framework-specific runtime branch.
- Absence of a workflow path does not prove the workflow is safe.
