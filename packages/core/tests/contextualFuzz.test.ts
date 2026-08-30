import { describe, expect, it } from 'vitest';
import {
    CAPABILITY_PRIVILEGES,
    CONTEXT_AVAILABILITIES,
    CONTROL_STATES,
    EXPOSURES,
    INTENTS,
    REACHABILITIES,
    assertFindingInvariants,
    evaluateContextualVerdict,
    formatRepositoryReportSarif,
    inferCapabilityIntent,
    isAcceptedVulnerabilityBasis,
    parseContextualEvaluationScenariosJson,
    validateContextualFindingPresentation,
    validateSarifLogShape,
    type CanonicalAnalysisIssue,
    type CanonicalIssueContext,
    type ControlStatus,
    type RepositoryExecutionReport,
    type VerdictDecision,
    type VerdictInput,
    type VulnerabilityBasis,
} from '../src';

const FUZZ_SEED_COUNT = 1000;
const UNKNOWN_VALUES = ['__unknown__', '', 'trusted-but-not-really', '🚧', 'nullish'];

function rng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function pick<T>(random: () => number, values: readonly T[]): T {
    return values[Math.floor(random() * values.length)];
}

function enumOrUnknown<T extends string>(random: () => number, values: readonly T[]): T {
    if (random() < 0.12) return pick(random, UNKNOWN_VALUES) as T;
    return pick(random, values);
}

function basis(seed: number, valid: boolean): Extract<VulnerabilityBasis, { kind: 'source_to_sink' }> {
    return valid
        ? {
            kind: 'source_to_sink',
            pathIds: [`path-${seed}`],
            untrustedSourceEvidenceIds: [`source-${seed}`],
            privilegedSinkEvidenceIds: [`sink-${seed}`],
            controlFailureEvidenceIds: [`control-${seed}`],
        }
        : ({
            kind: 'source_to_sink',
            pathIds: seed % 2 === 0 ? [] : 'not-an-array',
            untrustedSourceEvidenceIds: [],
            privilegedSinkEvidenceIds: [],
            controlFailureEvidenceIds: [],
        } as any);
}

function generateVerdictInput(seed: number): VerdictInput {
    const random = rng(seed);
    const directVariant = Math.floor(random() * 6);
    const directVulnerability = directVariant === 0
        ? { present: false }
        : directVariant === 1
            ? {
                present: true,
                basis: {
                    kind: 'direct_evidence',
                    directEvidenceClass: 'hardcoded_secret',
                    evidenceIds: [`direct-${seed}`],
                },
                ruleId: 'sec_hardcoded_secret',
                confidence: pick(random, ['confirmed', 'probable', 'potential'] as const),
                severityCeiling: pick(random, ['low', 'medium', 'high', 'critical'] as const),
            }
            : directVariant === 2
                ? {
                    present: true,
                    basis: {
                        kind: 'direct_evidence',
                        directEvidenceClass: 'hardcoded_secret',
                        evidenceIds: [],
                    },
                    ruleId: 'sec_hardcoded_secret',
                    confidence: 'confirmed',
                    severityCeiling: 'critical',
                }
                : directVariant === 3
                    ? {
                        present: true,
                        basis: {
                            kind: 'direct_evidence',
                            directEvidenceClass: 'hardcoded_secret',
                            evidenceIds: 'not-an-array',
                        },
                        ruleId: '',
                        confidence: '__unknown__',
                        severityCeiling: '__unknown__',
                    }
                    : directVariant === 4
                        ? undefined
                        : { present: false };

    return {
        capabilityPrivilege: enumOrUnknown(random, CAPABILITY_PRIVILEGES),
        exposure: enumOrUnknown(random, EXPOSURES),
        reachability: enumOrUnknown(random, REACHABILITIES),
        controlState: enumOrUnknown(random, CONTROL_STATES),
        contextAvailability: enumOrUnknown(random, CONTEXT_AVAILABILITIES),
        intent: enumOrUnknown(random, INTENTS),
        directVulnerability,
        sourceToSinkBasis: random() < 0.35 ? basis(seed, random() < 0.5) : undefined,
    } as VerdictInput;
}

function validControlStatus(value: unknown, decision: VerdictDecision): ControlStatus {
    if (decision.verdict === 'expected_capability') return 'effective';
    if (decision.verdict === 'needs_more_context') return 'unavailable';
    return (CONTROL_STATES as readonly string[]).includes(String(value))
        ? value as ControlStatus
        : 'unavailable';
}

function contextFrom(seed: number, input: VerdictInput, decision: VerdictDecision): CanonicalIssueContext {
    const status = validControlStatus((input as any).controlState, decision);
    const directEvidence = decision.vulnerabilityBasis?.kind === 'direct_evidence';
    return {
        artifactKind: 'skill',
        capability: 'shell',
        trustAssessment: {
            sources: input.exposure === 'trusted' ? ['developer_instruction'] : input.exposure === 'untrusted' ? ['user_input'] : ['unknown'],
            confidence: input.exposure === 'trusted' ? 'confirmed' : 'potential',
            evidenceIds: input.exposure === 'unknown' ? [] : [`trust-${seed}`],
        },
        intentAssessment: {
            expected: input.intent === 'expected' ? true : input.intent === 'unexpected' ? false : 'unknown',
            source: input.intent === 'expected' ? 'config' : 'inferred',
            confidence: input.intent === 'expected' ? 'confirmed' : 'potential',
            evidenceIds: input.intent === 'expected' ? [`intent-${seed}`] : [],
        },
        controlAssessment: {
            evaluationScope: status === 'unavailable' ? 'not_available' : 'complete',
            evaluations: [{
                control: status === 'effective' ? 'human_approval' : 'unknown',
                status,
                confidence: status === 'effective' ? 'confirmed' : 'potential',
                evidenceIds: status === 'unavailable' ? [] : [`control-${seed}`],
            }],
        },
        reachability: {
            pathIds: decision.vulnerabilityBasis?.kind === 'source_to_sink' ? decision.vulnerabilityBasis.pathIds : [],
            confidence: decision.vulnerabilityBasis ? 'confirmed' : 'potential',
            repositoryVerified: Boolean(decision.vulnerabilityBasis),
        },
        vulnerabilityBasis: decision.vulnerabilityBasis,
        verdict: decision.verdict === 'vulnerability' || !directEvidence
            ? decision.verdict
            : decision.verdict,
    };
}

function issueFrom(seed: number, input: VerdictInput, decision: VerdictDecision): CanonicalAnalysisIssue & {
    fix?: { safePattern?: string; ruleId?: string };
} {
    const ruleId = seed % 5 === 0 ? 'eff_token_bloat' : 'sec_contextual_fuzz';
    return {
        id: `issue-${seed}`,
        ruleId,
        severity: decision.severityCeiling,
        category: ruleId.startsWith('eff_') ? 'efficiency' : 'security',
        issue: 'Generated contextual issue.',
        impact: 'Generated contextual impact.',
        whyThisMatters: 'Generated contextual rationale.',
        howToFix: 'Apply the generated rule-owned fix.',
        evidence: [{ id: `evidence-${seed}`, ruleId }],
        fix: {
            quickFix: 'Apply a scoped fix.',
            recommendedFix: 'Apply a scoped fix.',
            safePattern: ruleId.startsWith('eff_') ? 'Keep the prompt concise.' : 'if (!approved) return;',
            effort: 'Quick',
            ruleId,
        },
        confidence: {
            score: 70,
            level: 'probable',
            label: 'Probable',
            definition: 'Evidence inferred from connected relationships.',
        },
        technicalDetails: {
            executionPath: 'Generated fuzz path.',
            evidence: [{ id: `evidence-${seed}`, ruleId, file: 'fuzz.prompt', snippet: 'generated' }],
            confidence: {
                score: 70,
                level: 'probable',
                label: 'Probable',
                definition: 'Evidence inferred from connected relationships.',
            },
        },
        impactedFiles: ['fuzz.prompt'],
        fixSuggestions: ['Apply a scoped fix.'],
        pathIds: [],
        context: contextFrom(seed, input, decision),
    } as any;
}

function malformedIssue(seed: number): CanonicalAnalysisIssue & { fix?: { safePattern?: string; ruleId?: string } } {
    return {
        id: `bad-${seed}`,
        ruleId: 'eff_token_bloat',
        severity: 'low',
        category: 'efficiency',
        issue: 'Generated malformed issue.',
        impact: 'Generated malformed impact.',
        whyThisMatters: 'Generated malformed rationale.',
        howToFix: 'Generated malformed fix.',
        evidence: [{ id: `bad-evidence-${seed}`, ruleId: 'sec_secret_exposure' }],
        fix: {
            safePattern: 'const apiKey = process.env.API_KEY;',
            ruleId: 'sec_secret_exposure',
        },
    };
}

function reportFor(issue: ReturnType<typeof issueFrom>): RepositoryExecutionReport {
    return {
        id: `report-${issue.id}`,
        version: '1.5.1',
        schemaVersion: 'fuzz',
        generated_at: '2026-06-23T00:00:00.000Z',
        repository: { root: '/fuzz', name: 'fuzz' },
        artifacts: [],
        executionMap: { nodes: [], edges: [], paths: [] },
        reachablePaths: [],
        summary: {
            aiSurfacesFound: { prompts: 0, skills: 0, mcpServers: 0, tools: 0, workflows: 0, memorySystems: 0, agentConfigs: 0 },
            executionGraph: { nodes: 0, edges: 0 },
            reachableSensitiveActions: { Shell: 0, Filesystem: 0, Network: 0, Secrets: 0, 'External APIs': 0 },
            riskSummary: { critical: 0, high: 0, medium: 0, low: 0 },
            confidenceSummary: { confirmed: 0, probable: 0, potential: 0 },
            trustStatus: 'Trusted',
        },
        issues: [issue as any],
        issueSummary: { total: 1, critical: 0, high: 0, medium: 0, low: 1 },
        impactedFiles: [],
        pathValidation: { valid: true, checkedPaths: 0, errors: [] },
        confidenceDefinitions: { confirmed: 'Direct evidence exists.', probable: 'Evidence inferred from connected relationships.', potential: 'Structural inference only.' },
        findings: [],
    };
}

describe('contextual deterministic fuzz harness', () => {
    it(`runs ${FUZZ_SEED_COUNT} generated VerdictInput seeds without invariant or serialization failures`, () => {
        const failingSeeds: Array<{ seed: number; error: string }> = [];

        for (let seed = 1; seed <= FUZZ_SEED_COUNT; seed += 1) {
            try {
                const input = generateVerdictInput(seed);
                const decision = evaluateContextualVerdict(input);
                expect(JSON.stringify(evaluateContextualVerdict(input))).toBe(JSON.stringify(decision));
                expect(['expected_capability', 'capability_review', 'risky_configuration', 'vulnerability', 'hardening_suggestion', 'quality_suggestion', 'needs_more_context']).toContain(decision.verdict);
                expect(['low', 'medium', 'high', 'critical']).toContain(decision.severityCeiling);
                expect(['confirmed', 'probable', 'potential']).toContain(decision.confidenceCeiling);

                if (decision.verdict === 'vulnerability') {
                    expect(isAcceptedVulnerabilityBasis(decision.vulnerabilityBasis)).toBe(true);
                }
                const hasAcceptedDirect = decision.vulnerabilityBasis?.kind === 'direct_evidence';
                if ((input as any).controlState === 'unavailable' && !hasAcceptedDirect) {
                    expect(decision.verdict).toBe('needs_more_context');
                    expect(decision.severityCeiling).toBe('low');
                }
                if ((input as any).controlState === 'present_unverified') {
                    expect(decision.verdict).not.toBe('expected_capability');
                }

                const issue = issueFrom(seed, input, decision);
                expect(() => assertFindingInvariants(issue, { requireContext: true, decision })).not.toThrow();

                const invalid = validateContextualFindingPresentation(malformedIssue(seed));
                expect(invalid.valid).toBe(false);
                expect(invalid.errors.join('\n')).toContain('belongs to');

                if (seed % 25 === 0) {
                    const sarif = JSON.parse(formatRepositoryReportSarif(reportFor(issue), { includeCapabilityInventory: true, includeQualitySuggestions: true }));
                    expect(validateSarifLogShape(sarif)).toEqual({ valid: true, errors: [] });
                }
            } catch (error: any) {
                failingSeeds.push({ seed, error: error?.message || String(error) });
            }
        }

        expect(failingSeeds).toEqual([]);
    });

    it('handles malformed threat-model-like and external evaluation inputs through typed failures or conservative inference', () => {
        expect(() => inferCapabilityIntent({
            artifactKind: 'skill',
            capability: 'shell',
            declaredExpectedCapabilities: { shell: true } as any,
            evidenceIds: ['ev'],
        })).not.toThrow();
        expect(inferCapabilityIntent({
            artifactKind: '__unknown__' as any,
            capability: '__unknown__' as any,
            declaredExpectedCapabilities: ['shell'] as any,
        })).toMatchObject({
            expected: 'unknown',
            source: 'unknown',
            confidence: 'potential',
        });
        expect(() => parseContextualEvaluationScenariosJson('not-json')).toThrow();
        expect(() => parseContextualEvaluationScenariosJson('[{"name":"x","category":"vulnerability"}]')).toThrow('input is required');
    });
});
