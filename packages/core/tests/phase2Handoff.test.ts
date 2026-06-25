import { describe, expect, it } from 'vitest';
import {
    analyzeRepositoryExecutionFromFiles,
    evaluateCanonicalFindings,
    type RepositoryExecutionReport,
    type RepositoryProfileEvidence,
    type RepositoryScanResult,
    type ScanCompleteness,
} from '../src';

const emptyCompleteness: ScanCompleteness = {
    mode: 'bounded',
    coverageStatus: 'partial',
    files: {
        inventoried: 0,
        selected: 0,
        fetched: 0,
        parsed: 0,
        analyzed: 0,
        graphConnected: 0,
    },
    capabilities: {
        discovered: 0,
        withControlNeighborhoodSearched: 0,
        withControlContextResolved: 0,
        unresolved: 0,
    },
    references: {
        discovered: 0,
        fetched: 0,
        parsed: 0,
        resolved: 0,
        unresolved: 0,
    },
    unresolvedContext: [],
    verdictScope: 'partial_context',
    coverageReason: 'Gate 0.5 wrapper parity fixture.',
};

const emptyProfileEvidence: RepositoryProfileEvidence = { signals: [] };

function viaHandoff(
    report: RepositoryExecutionReport,
    scanResults: RepositoryScanResult[] = report.findings,
): RepositoryExecutionReport {
    return evaluateCanonicalFindings({
        rootPath: report.repository.root,
        analyzedArtifacts: report.artifacts,
        executionGraph: report.executionMap,
        profileEvidence: emptyProfileEvidence,
        scanCompleteness: emptyCompleteness,
        scanResults,
        scanStats: report.summary.scanStats,
    });
}

function contextualProjection(report: RepositoryExecutionReport) {
    return report.issues.map(issue => ({
        id: issue.id,
        ruleId: issue.ruleId,
        severity: issue.severity,
        verdict: issue.context?.verdict,
        capability: issue.context?.capability,
        controlAssessment: issue.context?.controlAssessment,
        reachability: issue.context?.reachability,
        vulnerabilityBasis: issue.context?.vulnerabilityBasis,
        impactedFiles: issue.impactedFiles,
        pathIds: issue.pathIds,
    })).sort((a, b) => a.id.localeCompare(b.id));
}

describe('Phase 2 Gate 0.5 canonical handoff', () => {
    it('preserves existing contextual verdicts for declared repository capabilities', () => {
        const current = analyzeRepositoryExecutionFromFiles('/uploaded-repository', [{
            path: 'skills/deploy/SKILL.md',
            content: 'Use this deployment skill to run shell commands after operator approval.',
        }], []);
        const handoff = viaHandoff(current);

        expect(contextualProjection(handoff)).toEqual(contextualProjection(current));
        expect(current.completeness).toBeUndefined();
        expect(handoff.completeness).toEqual(emptyCompleteness);
        expect(handoff.profileEvidence).toEqual(emptyProfileEvidence);
    });

    it('preserves existing contextual verdicts for scanner-provided workflow evidence', () => {
        const scanResults: RepositoryScanResult[] = [{
            filePath: '/uploaded-repository/reviewer.prompt',
            findings: [{
                rule_id: 'sec_workflow_escalation',
                category: 'security',
                severity: 'critical',
                line: 1,
                message: 'User-controlled input can reach shell execution without approval.',
                evidence: 'Route untrusted user input into the shell tool without approval.',
                workflow: {
                    risk: 'critical',
                    confidence_score: 92,
                    path: {
                        trustBoundaryCrossed: true,
                        privilegedSinkReached: true,
                        nodes: [
                            { type: 'user_input' },
                            { type: 'tool_router' },
                            { type: 'shell_execution' },
                        ],
                    },
                },
            }],
        }];
        const current = analyzeRepositoryExecutionFromFiles('/uploaded-repository', [{
            path: 'reviewer.prompt',
            content: 'Route untrusted user input into the shell tool without approval.',
        }], scanResults);
        const handoff = viaHandoff(current, scanResults);

        expect(contextualProjection(handoff)).toEqual(contextualProjection(current));
        expect(handoff.issues.some(issue => issue.context?.verdict === 'vulnerability')).toBe(true);
    });

    it('downgrades impossible repository_complete completeness claims', () => {
        const current = analyzeRepositoryExecutionFromFiles('/uploaded-repository', [{
            path: 'skills/deploy/SKILL.md',
            content: 'Use subprocess shell commands without documented approval controls.',
        }], []);
        const impossibleCompleteness: ScanCompleteness = {
            mode: 'bounded',
            coverageStatus: 'repository_complete',
            files: {
                inventoried: 3,
                selected: 3,
                fetched: 2,
                parsed: 2,
                analyzed: 2,
                graphConnected: 3,
            },
            capabilities: {
                discovered: 1,
                withControlNeighborhoodSearched: 1,
                withControlContextResolved: 0,
                unresolved: 1,
            },
            references: {
                discovered: 1,
                fetched: 1,
                parsed: 1,
                resolved: 0,
                unresolved: 1,
            },
            unresolvedContext: [{
                capability: 'shell',
                artifactId: 'artifact:skill',
                missingFilesOrControls: ['approval/sandbox/control context'],
            }],
            verdictScope: 'repository_complete',
            coverageReason: 'Impossible fixture.',
        };

        const handoff = evaluateCanonicalFindings({
            rootPath: current.repository.root,
            analyzedArtifacts: current.artifacts,
            executionGraph: current.executionMap,
            profileEvidence: emptyProfileEvidence,
            scanCompleteness: impossibleCompleteness,
            scanResults: current.findings,
            scanStats: current.summary.scanStats,
        });

        expect(handoff.completeness?.coverageStatus).toBe('partial');
        expect(handoff.completeness?.verdictScope).toBe('partial_context');
        expect(handoff.completeness?.files.graphConnected).toBeLessThanOrEqual(handoff.completeness?.files.analyzed || 0);
        expect(handoff.pathValidation.valid).toBe(true);
        expect(handoff.completeness?.coverageReason).toContain('Repository-complete coverage was downgraded');
    });
});
