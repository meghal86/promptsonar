import { describe, expect, it } from 'vitest';
import {
    REPOSITORY_ARTIFACT_FILES,
    repositorySummaryMarkdown,
} from '../src/repository-summary';

describe('GitHub Action repository summary', () => {
    it('shows the PR-readable hierarchy with report-owned file counts and unchanged artifacts', () => {
        const report = {
            summary: {
                trustStatus: 'High Risk',
                riskSummary: { critical: 1, high: 1, medium: 0, low: 0 },
            },
            issueSummary: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
            issues: [{
                id: 'issue-low',
                severity: 'low',
                issue: 'Low priority issue.',
                impact: 'Minor inconsistency.',
                fix: { quickFix: 'Clarify the instruction.', effort: 'Quick' },
                impactedFiles: ['README.md'],
            }, {
                id: 'issue-1',
                severity: 'critical',
                issue: 'Untrusted instructions can reach shell execution.',
                impact: 'Commands could run without approval.',
                fix: { quickFix: 'Require approval.', effort: 'Moderate' },
                impactedFiles: ['prompts/reviewer.prompt'],
            }],
            impactedFiles: [{
                path: 'prompts/reviewer.prompt',
                issueCount: 1,
                highestSeverity: 'critical',
            }, {
                path: '.cursor/mcp.json',
                issueCount: 1,
                highestSeverity: 'high',
            }],
            reachablePaths: [{
                id: 'path-1',
                risk: 'critical',
                sensitiveActions: ['Shell'],
                explanation: 'Prompt reaches shell execution.',
                files: ['prompts/reviewer.prompt'],
            }],
        };

        const markdown = repositorySummaryMarkdown(report as any);

        expect(markdown).toContain('## Trust Status');
        expect(markdown).toContain('## Top Issues');
        expect(markdown).toContain('## Impacted Files (2)');
        expect(markdown).toContain('## Reachable Paths (1)');
        expect(markdown).toContain('## Artifacts Generated');
        expect(markdown).toContain('prompts/reviewer.prompt');
        expect(markdown).toContain('.cursor/mcp.json');
        expect(markdown.indexOf('Untrusted instructions can reach shell execution.')).toBeLessThan(markdown.indexOf('Low priority issue.'));
        for (const artifact of REPOSITORY_ARTIFACT_FILES) {
            expect(markdown).toContain(artifact);
        }
        expect(REPOSITORY_ARTIFACT_FILES).toEqual([
            'repository-report.json',
            'execution-map.json',
            'repository-report.html',
            'repository-report.sarif',
        ]);
    });
});
