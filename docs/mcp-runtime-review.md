# MCP Runtime Review Guide

MCP runtime review evaluates active MCP server definitions before an agent executes an MCP call.

It uses the existing MCP auditor and returns a runtime decision, verdict, risk score, findings, and evidence.

## API

```ts
import { reviewMcpRuntime } from '@promptsonar/core';

const review = reviewMcpRuntime([
  {
    name: 'localShell',
    config: {
      schemaVersion: '1.0',
      mcpServers: {
        localShell: {
          command: 'bash',
          tools: ['shell_exec', 'filesystem_access'],
          autoExecute: true,
          approvalRequired: false,
          permissions: ['*'],
        },
      },
    },
  },
]);

console.log(review.decision, review.verdict, review.riskScore?.score);
```

## Reviewed Surfaces

The runtime MCP review consumes the same evidence as `auditMcpConfig()`:

| Surface | Examples |
| --- | --- |
| Capabilities | filesystem, shell/process execution, network access |
| Permissions | wildcard permissions, all scopes, broad filesystem scope |
| Approval modes | `autoExecute`, `autoApprove`, `approvalRequired: false` |
| Credentials | host env passthrough and credential-like fields |
| Routing | MCP-to-MCP chains through route/upstream/delegate fields |
| Transport/auth | HTTP/local/raw-IP endpoints and remote servers without visible auth indicators |

## MCP Risk Score

Each MCP finding contributes a fixed deterministic weight. The auditor caps the score at 100 and maps it to:

| Score | Level |
| --- | --- |
| `0-24` | `LOW` |
| `25-49` | `MEDIUM` |
| `50-74` | `HIGH` |
| `75-100` | `CRITICAL` |

Runtime review maps that score into:

| Runtime score | Verdict | Decision |
| --- | --- | --- |
| `< 25` | `SAFE` | `ALLOW` |
| `25-74` | `REVIEW` | `WARN` |
| `>= 75` | `DANGEROUS` | `BLOCK` |

## Evidence

`review.evidence` contains finding evidence when present, otherwise finding messages. Examples include:

- `autoExecute=true`
- `approvalRequired=false`
- `permissions=["*"]`
- `shell_exec`
- `sinks=shell+filesystem; trigger=broad/wildcard scope`

Secrets are redacted by the existing MCP auditor before they are exposed as evidence.

## Result Shape

```json
{
  "decision": "BLOCK",
  "verdict": "DANGEROUS",
  "riskScore": {
    "score": 100,
    "level": "CRITICAL"
  },
  "audits": [],
  "findings": [],
  "evidence": []
}
```

`audits` contains full `McpAuditResult` objects, including per-server summaries when available.
