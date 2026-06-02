import {
  analyzeClaudeCodeRuntime,
  createPromptSonarMiddleware,
  parseRuntimeConfig,
  type AgentRuntimeAdapterInput,
  type ExecutionPathAnalysisResult,
  type RuntimeConfig,
  type RuntimeDecision,
  type RuntimeOperation,
} from '@promptsonar/core';

export type ClaudeCodeDecision = RuntimeDecision;
export type ClaudeCodeRiskVerdict = 'SAFE' | 'REVIEW' | 'DANGEROUS';

export interface ClaudeCodeExecutionReviewInput {
  prompt: string;
  systemPrompt?: string;
  plannedToolCall?: RuntimeOperation;
  toolDefinitions?: AgentRuntimeAdapterInput['activeTools'];
  mcpConfiguration?: AgentRuntimeAdapterInput['activeMcpServers'];
  memoryConfiguration?: AgentRuntimeAdapterInput['memoryConfiguration'];
  config?: RuntimeConfig;
}

export interface ClaudeCodeExecutionReview {
  decision: ClaudeCodeDecision;
  executionVerdict: ClaudeCodeRiskVerdict;
  riskScore: number;
  executionPath: string[];
  evidence: string[];
  confidence: {
    score: number;
    level: string;
  };
  rootCause?: {
    ruleId: string;
    severity: string;
    explanation: string;
    supportingFindings: string[];
  };
  workflowDiff?: {
    riskReduction: number;
    executionPathRemoved: boolean;
    beforePath: string[];
    afterPath: string[];
  };
  raw: ExecutionPathAnalysisResult;
}

export interface ClaudeCodeGuardOptions {
  config?: RuntimeConfig;
  onReview?: (review: ClaudeCodeExecutionReview) => void;
  onWarn?: (review: ClaudeCodeExecutionReview) => void;
  onBlock?: (review: ClaudeCodeExecutionReview) => void;
}

export class ClaudeCodePromptSonarBlockedError extends Error {
  constructor(readonly review: ClaudeCodeExecutionReview) {
    super(`PromptSonar blocked Claude Code execution: ${review.executionVerdict}`);
    this.name = 'ClaudeCodePromptSonarBlockedError';
  }
}

function toRuntimeInput(input: ClaudeCodeExecutionReviewInput): AgentRuntimeAdapterInput {
  return {
    activePrompt: input.prompt,
    systemPrompt: input.systemPrompt,
    activeTools: input.toolDefinitions,
    activeMcpServers: input.mcpConfiguration,
    memoryConfiguration: input.memoryConfiguration,
    operation: input.plannedToolCall,
    config: input.config,
  };
}

function toReview(result: ExecutionPathAnalysisResult): ClaudeCodeExecutionReview {
  const workflow = result.workflow;
  const rootCause = result.rootCause;
  const diff = result.workflowDiff;
  return {
    decision: result.decision,
    executionVerdict: result.executionVerdict,
    riskScore: result.riskScore,
    executionPath: workflow?.path.nodes.map((node) => node.type) ?? [],
    evidence: result.evidence,
    confidence: {
      score: result.confidence.confidenceScore,
      level: result.confidence.confidenceLevel,
    },
    rootCause: rootCause ? {
      ruleId: rootCause.rootCause.rule_id,
      severity: rootCause.rootCause.severity,
      explanation: rootCause.rootCause.explanation,
      supportingFindings: rootCause.supportingFindings.map((finding) => finding.rule_id),
    } : undefined,
    workflowDiff: diff ? {
      riskReduction: diff.riskReduction,
      executionPathRemoved: diff.executionPathRemoved,
      beforePath: diff.before.nodes.map((node) => node.type),
      afterPath: diff.after.nodes.map((node) => node.type),
    } : undefined,
    raw: result,
  };
}

export function reviewClaudeCodeExecution(input: ClaudeCodeExecutionReviewInput): ClaudeCodeExecutionReview {
  return toReview(analyzeClaudeCodeRuntime(toRuntimeInput(input)));
}

export function parseClaudeCodePromptSonarConfig(content: string): RuntimeConfig {
  return parseRuntimeConfig(content);
}

function formatPath(path: string[]): string {
  return path.length ? path.map((node) => node.toUpperCase().replace(/_/g, ' ')).join(' -> ') : 'No execution path inferred';
}

export function formatClaudeCodeReview(review: ClaudeCodeExecutionReview): string {
  return [
    'PromptSonar Review',
    '',
    'Verdict:',
    review.decision,
    '',
    'Execution Path:',
    formatPath(review.executionPath),
    '',
    'Evidence:',
    ...(review.evidence.length ? review.evidence.map((item) => `- ${item}`) : ['- No evidence emitted.']),
    '',
    'Root Cause:',
    review.rootCause?.ruleId || 'none',
    '',
    'Confidence:',
    `${review.confidence.score}% ${review.confidence.level}`,
    '',
    'Recommended Fix:',
    review.raw.findings.find((finding) => finding.suggested_fix)?.suggested_fix || 'Review the execution path and add least-privilege approval boundaries.',
  ].join('\n');
}

export function createClaudeCodePromptSonarGuard(options: ClaudeCodeGuardOptions = {}) {
  const middleware = createPromptSonarMiddleware({
    config: options.config,
    onReview: (result) => options.onReview?.(toReview(result)),
    onWarn: (result) => options.onWarn?.(toReview(result)),
    onBlock: (result) => options.onBlock?.(toReview(result)),
  });

  return {
    review(input: ClaudeCodeExecutionReviewInput): ClaudeCodeExecutionReview {
      return reviewClaudeCodeExecution({
        ...input,
        config: input.config || options.config,
      });
    },

    beforeExecution(input: ClaudeCodeExecutionReviewInput): ClaudeCodeExecutionReview {
      const result = middleware.beforeExecution({
        activePrompt: input.prompt,
        systemPrompt: input.systemPrompt,
        activeTools: input.toolDefinitions,
        activeMcpServers: input.mcpConfiguration,
        memoryConfiguration: input.memoryConfiguration,
        operation: input.plannedToolCall,
        config: input.config || options.config,
      });
      return toReview(result);
    },

    assertAllowed(input: ClaudeCodeExecutionReviewInput): ClaudeCodeExecutionReview {
      const review = this.beforeExecution(input);
      if (review.decision === 'BLOCK') {
        throw new ClaudeCodePromptSonarBlockedError(review);
      }
      return review;
    },
  };
}

export type {
  AgentRuntimeAdapterInput,
  ExecutionPathAnalysisResult,
  RuntimeConfig,
  RuntimeOperation,
};

