import { describe, expect, it } from 'vitest';
import { buildPrReviewSummaryMarkdown } from '../src/pr-review/markdown';

describe('PR review markdown summary', () => {
    it('renders counts, provenance, MCP risk, and workflow diff', () => {
        const markdown = buildPrReviewSummaryMarkdown({
            filesScanned: 2,
            counts: { critical: 1, high: 2, medium: 3 },
            executionPaths: ['Shell Execution'],
            confidence: { score: 92, level: 'HIGH' },
            rootCause: { name: 'MCP Tool Poisoning', supporting: ['Workflow Escalation'] },
            provenanceEvidence: ['autoExecute=true'],
            mcpRisk: {
                score: 85,
                severity: 'CRITICAL',
                capabilities: ['shell'],
                approvalMode: 'Automatic',
            },
            workflowDiffs: [{
                filePath: 'prompts/agent.prompt',
                before: 'USER INPUT -> MODEL -> RESPONSE',
                after: 'USER INPUT -> TOOL ROUTER -> SHELL EXECUTION',
                introduced: true,
                riskReduction: 0,
            }],
        });

        expect(markdown).toContain('Files Scanned:** 2');
        expect(markdown).toContain('1 Critical');
        expect(markdown).toContain('Shell Execution');
        expect(markdown).toContain('92% HIGH');
        expect(markdown).toContain('MCP Tool Poisoning');
        expect(markdown).toContain('- autoExecute=true');
        expect(markdown).toContain('85 (CRITICAL)');
        expect(markdown).toContain('New Privileged Execution Path Introduced');
    });
});

