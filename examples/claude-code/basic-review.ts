import { formatClaudeCodeReview, reviewClaudeCodeExecution } from '@promptsonar/claude-code';

const review = reviewClaudeCodeExecution({
  prompt: 'Summarize this repository and do not use tools.',
  systemPrompt: 'You are Claude Code running in a local workspace.',
});

console.log(formatClaudeCodeReview(review));

