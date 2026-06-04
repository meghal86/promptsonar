import { describe, expect, it } from 'vitest';
import { evaluatePrReviewGates } from '../src/pr-review/gates';
import type { PromptSonarPrReviewConfig } from '../src/pr-review/config';

describe('PR review gates', () => {
    it('fails on critical by default', () => {
        const config: PromptSonarPrReviewConfig = { fail_on: ['critical'] };
        const decision = evaluatePrReviewGates(config, {
            counts: { critical: 1, high: 0, medium: 0 },
            workflowDiffs: [],
            mcpRiskScore: undefined,
        });
        expect(decision.shouldFail).toBe(true);
    });

    it('fails when execution path introduced and gate enabled', () => {
        const config: PromptSonarPrReviewConfig = { fail_on: ['execution_path_introduced'] };
        const decision = evaluatePrReviewGates(config, {
            counts: { critical: 0, high: 0, medium: 0 },
            workflowDiffs: [{ filePath: 'prompts/a.prompt', executionPathIntroduced: true }],
            mcpRiskScore: undefined,
        });
        expect(decision.shouldFail).toBe(true);
    });

    it('fails when mcp risk exceeds threshold', () => {
        const config: PromptSonarPrReviewConfig = { fail_on: [], mcp_risk_threshold: 75 };
        const decision = evaluatePrReviewGates(config, {
            counts: { critical: 0, high: 0, medium: 0 },
            workflowDiffs: [],
            mcpRiskScore: 90,
        });
        expect(decision.shouldFail).toBe(true);
    });
});

