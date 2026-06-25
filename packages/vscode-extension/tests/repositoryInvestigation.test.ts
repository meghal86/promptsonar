import { describe, expect, it } from 'vitest';
import {
    buildRepositoryFileInvestigations,
    editorLineForEvidence,
    renderRepositoryFileInvestigations,
} from '../src/client/repositoryInvestigation';

describe('VS Code repository file investigation', () => {
    it('builds file-owned issues, impact, inline evidence, fixes, and paths from the report', () => {
        const report = {
            repository: { root: '/workspace/repo' },
            impactedFiles: [{
                path: 'prompts/reviewer.prompt',
                name: 'reviewer.prompt',
                type: 'Prompt',
                issueIds: ['issue-1'],
                issueCount: 1,
                highestSeverity: 'critical',
                pathIds: ['path-1'],
            }],
            issues: [{
                id: 'issue-1',
                severity: 'critical',
                issue: 'Untrusted instructions can reach a sensitive action.',
                impact: 'Commands could run without approval.',
                evidence: [{
                    id: 'evidence-1',
                    file: 'prompts/reviewer.prompt',
                    line: 7,
                    snippet: 'run shell commands',
                }],
                fix: {
                    quickFix: 'Require approval immediately.',
                    recommendedFix: 'Separate untrusted input and enforce scoped tools.',
                    safePattern: 'if (approved) runScopedAction(input);',
                    effort: 'Moderate',
                },
                pathIds: ['path-1'],
            }],
            reachablePaths: [{
                id: 'path-1',
                risk: 'critical',
                explanation: 'Prompt reaches shell execution.',
                sensitiveActions: ['Shell'],
                files: ['/workspace/repo/prompts/reviewer.prompt'],
            }],
        };

        const investigations = buildRepositoryFileInvestigations(report);

        expect(investigations).toHaveLength(report.impactedFiles.length);
        expect(investigations[0].absolutePath).toBe('/workspace/repo/prompts/reviewer.prompt');
        expect(investigations[0].issues.map(issue => issue.id)).toEqual(['issue-1']);
        expect(investigations[0].impacts).toEqual(['Commands could run without approval.']);
        expect(investigations[0].evidence[0]).toMatchObject({
            line: 7,
            snippet: 'run shell commands',
        });
        expect(investigations[0].fixes.map(fix => fix.label)).toEqual([
            'Quick Fix',
            'Recommended Fix',
            'Safe Pattern',
            'Effort',
        ]);
        expect(investigations[0].executionPaths.map(path => path.id)).toEqual(['path-1']);
    });

    it('renders file investigation controls with line-aware source navigation', () => {
        const html = renderRepositoryFileInvestigations(buildRepositoryFileInvestigations({
            repository: { root: '/workspace/repo' },
            impactedFiles: [{
                path: 'SKILL.md',
                name: 'SKILL.md',
                type: 'SKILL.md',
                issueIds: ['issue-1'],
                issueCount: 1,
                highestSeverity: 'high',
                pathIds: [],
            }],
            issues: [{
                id: 'issue-1',
                severity: 'high',
                context: { verdict: 'needs_more_context' },
                issue: 'A skill can invoke a sensitive tool.',
                impact: 'The tool could modify repository files.',
                evidence: [{ id: 'evidence-1', file: 'SKILL.md', line: 3, snippet: 'use shell' }],
                fix: {
                    quickFix: 'Disable automatic execution.',
                    recommendedFix: 'Require approval.',
                    safePattern: 'autoApprove: false',
                    effort: 'Quick',
                },
                pathIds: [],
            }],
            reachablePaths: [],
        }));

        expect(html).toContain('These are the files you should fix.');
        expect(html).toContain('data-investigate-file="SKILL.md"');
        expect(html).toContain('data-open-file="/workspace/repo/SKILL.md"');
        expect(html).toContain('data-line="3"');
        expect(html).toContain('Evidence');
        expect(html).toContain('Needs more context');
        expect(html).toContain('Quick Fix');
        expect(html).toContain('Execution Paths');
        expect(editorLineForEvidence(3)).toBe(2);
        expect(editorLineForEvidence(undefined)).toBe(0);
    });
});
