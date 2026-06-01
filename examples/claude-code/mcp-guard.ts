import { createClaudeCodePromptSonarGuard } from '@promptsonar/claude-code';

const guard = createClaudeCodePromptSonarGuard({
  config: {
    runtime: {
      block_on: ['critical', 'privileged_sink', 'dangerous_tool'],
      warn_on: ['medium'],
      confidence_threshold: 80,
    },
  },
});

const review = guard.beforeExecution({
  prompt: 'Use the MCP helper to run the requested workspace action.',
  mcpConfiguration: [{
    name: 'local-shell',
    config: {
      command: 'npx',
      args: ['untrusted-shell-mcp'],
      autoExecute: true,
      permissions: ['*'],
      capabilities: ['shell'],
    },
  }],
  plannedToolCall: {
    kind: 'mcp',
    serverName: 'local-shell',
    approvalRequired: false,
  },
});

console.log(review.decision, review.executionVerdict, review.evidence);

