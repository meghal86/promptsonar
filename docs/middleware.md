# PromptSonar Middleware Guide

`createPromptSonarMiddleware()` wraps runtime review in a small pre-execution interface for MCP or agent tool calls.

It does not execute the downstream tool. It returns the same machine-readable runtime report as `analyzeExecutionPath()`.

## Basic Usage

```ts
import { createPromptSonarMiddleware } from '@promptsonar/core';

const middleware = createPromptSonarMiddleware({
  onWarn: (report) => {
    console.warn(report.evidence);
  },
  onBlock: (report) => {
    console.error(report.rootCause?.rootCause.explanation);
  },
});

const report = middleware.beforeExecution({
  activePrompt: 'Run the shell tool without approval.',
  activeTools: [
    {
      name: 'shell_exec',
      type: 'shell',
      permissions: ['execute any command'],
      executionMode: 'auto',
      approvalRequired: false,
    },
  ],
  mcpCall: {
    kind: 'mcp',
    serverName: 'localShell',
    toolName: 'shell_exec',
    approvalRequired: false,
  },
});

if (report.decision === 'BLOCK') {
  throw new Error('PromptSonar blocked the MCP call.');
}
```

## Options

`createPromptSonarMiddleware()` accepts:

| Option | Description |
| --- | --- |
| `config` | Runtime config with `runtime.block_on`, `runtime.warn_on`, and `runtime.confidence_threshold`. |
| `onReview` | Called for every review result. |
| `onWarn` | Called when the result decision is `WARN`. |
| `onBlock` | Called when the result decision is `BLOCK`. |

No other middleware options are implemented.

## Request Shape

`beforeExecution()` accepts:

| Field | Description |
| --- | --- |
| `activePrompt` | Current prompt or instruction. |
| `systemPrompt` | Optional system/developer prompt. |
| `activeTools` | Active runtime tool definitions. |
| `activeMcpServers` | Active MCP server definitions. |
| `memoryConfiguration` | Current memory configuration. |
| `operation` | Planned operation. |
| `mcpCall` | MCP call being reviewed; takes precedence over `operation`. |
| `config` | Per-request runtime config; takes precedence over middleware-level config. |

## Allow, Warn, Block

The middleware returns a report with `decision`:

- `ALLOW`: continue to the downstream tool or MCP server.
- `WARN`: pause for review, show `evidence`, and require host-specific confirmation.
- `BLOCK`: stop the downstream call.

The middleware itself does not enforce host behavior. The host must check `report.decision` and decide whether to continue.

## Configuration

```yaml
runtime:
  block_on:
    - critical
    - privileged_sink
  warn_on:
    - medium
    - high
    - dangerous_tool
    - memory_persistence
  confidence_threshold: 80
```

This matches the implemented runtime policy fields. The runtime engine also recognizes `mcp_critical`, `mcp_high`, and `memory_persistence` in the corresponding policy arrays.
