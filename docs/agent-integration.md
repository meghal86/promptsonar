# Agent Integration Guide

PromptSonar runtime review is designed to sit immediately before execution in an agent loop.

```text
Prompt
  ↓
Agent plans tool usage
  ↓
PromptSonar Review
  ↓
ALLOW / WARN / BLOCK
  ↓
Tool or MCP execution
```

The integration is generic: collect the active prompt, active tool definitions, active MCP server definitions, memory settings, and planned operation, then call the appropriate runtime API.

## Generic Agents

```ts
import { analyzeExecutionPath } from '@promptsonar/core';

const report = analyzeExecutionPath({
  prompt: activePrompt,
  systemPrompt,
  toolDefinitions: activeTools,
  mcpDefinitions: activeMcpServers,
  memoryConfiguration,
  operation: plannedOperation,
});

if (report.decision === 'BLOCK') {
  throw new Error(`PromptSonar blocked execution: ${report.executionVerdict}`);
}

if (report.decision === 'WARN') {
  console.warn(report.evidence);
}
```

Use `report.workflow`, `report.confidence`, `report.rootCause`, `report.toolRiskSummary`, `report.memoryRiskSummary`, and `report.mcpRuntimeReview` to display evidence to the developer or agent operator.

## Cursor

Use `analyzeCursorRuntime()` when the host integration is Cursor-oriented:

```ts
import { analyzeCursorRuntime } from '@promptsonar/core';

const report = analyzeCursorRuntime({
  activePrompt,
  systemPrompt,
  activeTools,
  activeMcpServers,
  memoryConfiguration,
  operation: plannedOperation,
});
```

This adapter is intentionally thin. It does not depend on Cursor-specific private APIs. The caller supplies the active prompt, tools, MCP servers, memory settings, and operation.

## Claude Code

Use `analyzeClaudeCodeRuntime()` for Claude Code integrations:

```ts
import { analyzeClaudeCodeRuntime } from '@promptsonar/core';

const report = analyzeClaudeCodeRuntime({
  activePrompt,
  activeTools,
  activeMcpServers,
  operation: {
    kind: 'shell',
    toolName: 'bash',
    approvalRequired: false,
  },
});
```

The result contains the same runtime report shape as `analyzeExecutionPath()`.

## OpenAI Codex

Use `analyzeCodexRuntime()` for Codex-style coding agents:

```ts
import { analyzeCodexRuntime } from '@promptsonar/core';

const report = analyzeCodexRuntime({
  activePrompt,
  activeTools,
  activeMcpServers,
  memoryConfiguration,
  operation: plannedOperation,
});
```

## Windsurf

Use `analyzeWindsurfRuntime()` for Windsurf-style coding agents:

```ts
import { analyzeWindsurfRuntime } from '@promptsonar/core';

const report = analyzeWindsurfRuntime({
  activePrompt,
  activeTools,
  activeMcpServers,
  operation: plannedOperation,
});
```

## Integration Behavior

The adapter functions:

- Normalize the host-specific naming into `analyzeExecutionPath()`.
- Use logical file paths such as `cursor-runtime.prompt` or `claude-code-runtime.prompt` for provenance.
- Return the same `ExecutionPathAnalysisResult` contract.
- Do not execute tools, mutate files, call models, log telemetry, or call cloud services.

## Recommended Host Flow

1. Capture the current prompt and system/developer context.
2. Capture the tool plan before execution.
3. Pass active tool definitions, MCP configs, memory config, and planned operation to PromptSonar.
4. If `decision` is `BLOCK`, stop execution and show evidence.
5. If `decision` is `WARN`, require developer review or host-specific confirmation.
6. If `decision` is `ALLOW`, continue with the planned action.
