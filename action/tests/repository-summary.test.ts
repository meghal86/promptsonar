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

    it('surfaces the production vs non-production split and labels non-production issues', () => {
        const report = {
            summary: {
                trustStatus: 'High Risk',
                riskSummary: { critical: 0, high: 1, medium: 0, low: 0 },
                productionIssueSummary: { total: 1, critical: 0, high: 1, medium: 0, low: 0 },
                nonProductionIssueSummary: { total: 1, critical: 1, high: 0, medium: 0, low: 0 },
            },
            issueSummary: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
            issues: [{
                id: 'issue-doc-crit',
                severity: 'critical',
                provenance: 'documentation',
                issue: 'Documentation describes an injection example.',
                impact: 'Illustrative only.',
                fix: { quickFix: 'No action — example.', effort: 'Quick' },
                impactedFiles: ['docs/GUIDE.md'],
            }, {
                id: 'issue-prod-high',
                severity: 'high',
                provenance: 'production',
                issue: 'Production prompt can leak PII.',
                impact: 'Real risk.',
                fix: { quickFix: 'Redact PII.', effort: 'Moderate' },
                impactedFiles: ['prompts/agent.prompt'],
            }],
            impactedFiles: [],
            reachablePaths: [],
        };

        const markdown = repositorySummaryMarkdown(report as any);

        expect(markdown).toContain('1 production issues');
        expect(markdown).toContain('Non-production (docs/tests/fixtures): 1 critical');
        expect(markdown).toContain('not counted toward trust');
        expect(markdown).toContain('| Severity | Context | Issue | Impacted Files | Quick Fix |');
        // Production issue leads the table even though the doc issue is critical.
        expect(markdown.indexOf('Production prompt can leak PII.')).toBeLessThan(markdown.indexOf('Documentation describes an injection example.'));
        expect(markdown).toContain('documentation');
    });
});
