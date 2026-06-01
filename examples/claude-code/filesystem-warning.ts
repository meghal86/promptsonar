import { createClaudeCodePromptSonarGuard } from '@promptsonar/claude-code';

const guard = createClaudeCodePromptSonarGuard({
  config: {
    runtime: {
      block_on: ['critical'],
      warn_on: ['medium', 'dangerous_tool'],
      confidence_threshold: 80,
    },
  },
});

const review = guard.beforeExecution({
  prompt: 'Read package metadata from the current workspace.',
  toolDefinitions: [{
    name: 'workspace_read',
    type: 'filesystem',
    permissions: ['read workspace files'],
    executionMode: 'manual',
    approvalRequired: true,
  }],
  plannedToolCall: {
    kind: 'filesystem',
    toolName: 'workspace_read',
    approvalRequired: true,
  },
});

console.log(`Decision: ${review.decision}`);
console.log(`Evidence: ${review.evidence.join(', ') || 'none'}`);

