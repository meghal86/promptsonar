import { describe, expect, it } from 'vitest';
import {
    evaluateContextualVerdict,
    isAcceptedVulnerabilityBasis,
    validateContextualFindingPresentation,
    validateFindingInvariants,
    type CanonicalAnalysisIssue,
    type ContextualFindingPresentationValidation,
    type FindingInvariantContext,
    type FindingInvariantValidation,
    type VerdictDecision,
    type VerdictInput,
    type VulnerabilityBasis,
} from '../src';

type Mutant = {
    target: 'verdict' | 'binding' | 'invariants';
    id: string;
    survives: () => boolean;
};

type MutationReport = {
    target: Mutant['target'];
    total: number;
    killed: number;
    score: number;
    survivors: string[];
};

const sourceToSinkBasis: Extract<VulnerabilityBasis, { kind: 'source_to_sink' }> = {
    kind: 'source_to_sink',
    pathIds: ['path-1'],
    untrustedSourceEvidenceIds: ['source-1'],
    privilegedSinkEvidenceIds: ['sink-1'],
    controlFailureEvidenceIds: ['control-1'],
};

const directBasis: Extract<VulnerabilityBasis, { kind: 'direct_evidence' }> = {
    kind: 'direct_evidence',
    directEvidenceClass: 'hardcoded_secret',
    evidenceIds: ['secret-1'],
};

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
    return {
        capabilityPrivilege: 'privileged',
        exposure: 'trusted',
        reachability: 'verified',
        controlState: 'effective',
        contextAvailability: 'complete',
        intent: 'expected',
        directVulnerability: { present: false },
        ...overrides,
    };
}

const verdictSamples = {
    expected: input(),
    missingExpected: input({ controlState: 'missing' }),
    unavailable: input({ controlState: 'unavailable', contextAvailability: 'unavailable' }),
    presentUnverified: input({ controlState: 'present_unverified' }),
    unknownTrust: input({ exposure: 'unknown' }),
    sourceToSink: input({
        exposure: 'untrusted',
        controlState: 'missing',
        intent: 'unexpected',
        sourceToSinkBasis,
    }),
    invalidDirect: input({
        capabilityPrivilege: 'ordinary',
        directVulnerability: {
            present: true,
            basis: {
                kind: 'direct_evidence',
                directEvidenceClass: 'hardcoded_secret',
                evidenceIds: [],
            },
            ruleId: 'sec_hardcoded_secret',
            confidence: 'confirmed',
            severityCeiling: 'critical',
        },
    }),
    directHigh: input({
        capabilityPrivilege: 'ordinary',
        directVulnerability: {
            present: true,
            basis: directBasis,
            ruleId: 'sec_hardcoded_secret',
            confidence: 'confirmed',
            severityCeiling: 'high',
        },
    }),
};

function verdictProperties(evaluate: (value: VerdictInput) => VerdictDecision): string[] {
    const errors: string[] = [];
    const decisions = Object.entries(verdictSamples).map(([name, sample]) => [name, sample, evaluate(sample)] as const);

    for (const [name, , decision] of decisions) {
        if (decision.verdict === 'vulnerability' && !isAcceptedVulnerabilityBasis(decision.vulnerabilityBasis)) {
            errors.push(`${name}: vulnerability without accepted basis`);
        }
        if (decision.verdict !== 'vulnerability' && decision.severityCeiling === 'critical') {
            errors.push(`${name}: critical non-vulnerability`);
        }
    }

    if (evaluate(verdictSamples.expected).verdict !== 'expected_capability') errors.push('expected capability changed');
    if (evaluate(verdictSamples.missingExpected).verdict !== 'risky_configuration') errors.push('missing control no longer risky');
    if (evaluate(verdictSamples.unavailable).verdict !== 'needs_more_context') errors.push('unavailable control not needs_more_context');
    if (evaluate(verdictSamples.unavailable).severityCeiling !== 'low') errors.push('unavailable control raised severity');
    if (evaluate(verdictSamples.presentUnverified).verdict === 'expected_capability') errors.push('present_unverified satisfied expected capability');
    if (evaluate(verdictSamples.unknownTrust).verdict === 'expected_capability') errors.push('unknown trust treated as expected');
    if (evaluate(verdictSamples.sourceToSink).verdict !== 'vulnerability') errors.push('source-to-sink vulnerability suppressed');
    if (evaluate(verdictSamples.invalidDirect).verdict === 'vulnerability') errors.push('invalid direct evidence accepted');
    if (evaluate(verdictSamples.directHigh).severityCeiling !== 'high') errors.push('direct evidence exceeded severity ceiling');

    return errors;
}

function makeDecision(overrides: Partial<VerdictDecision>): VerdictDecision {
    return {
        verdict: 'capability_review',
        severityCeiling: 'low',
        confidenceCeiling: 'potential',
        explanationCode: 'mutant',
        ...overrides,
    };
}

function bindingIssue(overrides: any = {}): any {
    return {
        id: 'issue-binding',
        ruleId: 'eff_token_bloat',
        category: 'efficiency',
        fix: {
            safePattern: 'Keep prompts concise.',
            ruleId: 'eff_token_bloat',
        },
        evidence: [{ id: 'ev-1', ruleId: 'eff_token_bloat' }],
        ...overrides,
    };
}

function bindingProperties(validate: (issue: any) => ContextualFindingPresentationValidation): string[] {
    const errors: string[] = [];
    if (!validate(bindingIssue()).valid) errors.push('valid binding rejected');
    if (validate(bindingIssue({ evidence: [{ id: 'ev-1', ruleId: 'sec_secret_exposure' }] })).valid) errors.push('cross-rule evidence accepted');
    if (validate(bindingIssue({ fix: { safePattern: 'Keep prompts concise.', ruleId: 'sec_secret_exposure' } })).valid) errors.push('cross-rule fix accepted');
    if (validate(bindingIssue({ fix: { safePattern: 'const apiKey = process.env.API_KEY;', ruleId: 'eff_token_bloat' } })).valid) errors.push('secret safe pattern accepted for efficiency rule');
    if (validate(bindingIssue({ category: 'security' })).valid) errors.push('efficiency rule security category accepted');
    if (validate(bindingIssue({ presentationProvenance: { issueRuleId: 'sec_secret_exposure' } })).valid) errors.push('cross-rule presentation provenance accepted');
    return errors;
}

function canonicalIssue(overrides: Partial<CanonicalAnalysisIssue> = {}): CanonicalAnalysisIssue {
    return {
        id: 'issue-invariant',
        ruleId: 'sec_contextual',
        severity: 'low',
        category: 'security',
        issue: 'Invariant issue.',
        impact: 'Invariant impact.',
        whyThisMatters: 'Invariant rationale.',
        howToFix: 'Invariant fix.',
        evidence: [{ id: 'ev-1', ruleId: 'sec_contextual' }],
        ...overrides,
    };
}

function context(overrides: any = {}): any {
    return {
        artifactKind: 'skill',
        capability: 'shell',
        trustAssessment: { sources: ['developer_instruction'], confidence: 'confirmed', evidenceIds: ['ev-trust'] },
        intentAssessment: { expected: true, source: 'config', confidence: 'confirmed', evidenceIds: ['ev-intent'] },
        controlAssessment: {
            evaluationScope: 'complete',
            evaluations: [{ control: 'human_approval', status: 'effective', confidence: 'confirmed', evidenceIds: ['ev-control'] }],
        },
        reachability: { pathIds: ['path-1'], confidence: 'confirmed', repositoryVerified: true },
        verdict: 'expected_capability',
        ...overrides,
    };
}

function invariantProperties(validate: (issue: CanonicalAnalysisIssue, context?: FindingInvariantContext) => FindingInvariantValidation): string[] {
    const errors: string[] = [];
    if (!validate(canonicalIssue({ context: context() }), { requireContext: true }).valid) errors.push('valid invariant rejected');
    if (validate(canonicalIssue(), { requireContext: true }).valid) errors.push('missing required context accepted');
    if (validate(canonicalIssue({ severity: 'critical', context: context({ verdict: 'capability_review' }) })).valid) errors.push('critical non-vulnerability accepted');
    if (validate(canonicalIssue({ severity: 'high', context: context({ verdict: 'needs_more_context' }) })).valid) errors.push('needs_more_context high accepted');
    if (validate(canonicalIssue({
        context: context({
            verdict: 'vulnerability',
            vulnerabilityBasis: { kind: 'source_to_sink', pathIds: [], untrustedSourceEvidenceIds: [], privilegedSinkEvidenceIds: [], controlFailureEvidenceIds: [] },
        }),
    })).valid) errors.push('vulnerability without basis accepted');
    if (validate(canonicalIssue({
        context: context({
            verdict: 'expected_capability',
            controlAssessment: {
                evaluationScope: 'complete',
                evaluations: [{ control: 'human_approval', status: 'present_unverified', confidence: 'potential', evidenceIds: ['ev-control'] }],
            },
        }),
    })).valid) errors.push('present_unverified expected capability accepted');
    if (validate(canonicalIssue({
        context: context({
            verdict: 'risky_configuration',
            controlAssessment: {
                evaluationScope: 'not_available',
                evaluations: [{ control: 'human_approval', status: 'unavailable', confidence: 'potential', evidenceIds: [] }],
            },
        }),
    })).valid) errors.push('unavailable control risky configuration accepted');
    if (validate(canonicalIssue(), { decision: makeDecision({ verdict: 'capability_review', severityCeiling: 'critical' }) }).valid) errors.push('critical decision without vulnerability accepted');
    return errors;
}

function filterErrors(validation: FindingInvariantValidation | ContextualFindingPresentationValidation, patterns: RegExp[]): any {
    const errors = validation.errors.filter(error => !patterns.some(pattern => pattern.test(error)));
    return { valid: errors.length === 0, errors };
}

const mutants: Mutant[] = [
    {
        target: 'verdict',
        id: 'verdict_capability_presence_as_vulnerability',
        survives: () => verdictProperties(sample => sample.capabilityPrivilege === 'privileged'
            ? makeDecision({ verdict: 'vulnerability', severityCeiling: 'critical' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_accepts_invalid_direct_evidence',
        survives: () => verdictProperties(sample => sample === verdictSamples.invalidDirect
            ? makeDecision({ verdict: 'vulnerability', severityCeiling: 'critical', vulnerabilityBasis: (sample.directVulnerability as any).basis })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_unavailable_as_expected',
        survives: () => verdictProperties(sample => sample === verdictSamples.unavailable
            ? makeDecision({ verdict: 'expected_capability', severityCeiling: 'low', confidenceCeiling: 'confirmed' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_present_unverified_as_expected',
        survives: () => verdictProperties(sample => sample === verdictSamples.presentUnverified
            ? makeDecision({ verdict: 'expected_capability', severityCeiling: 'low', confidenceCeiling: 'confirmed' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_source_to_sink_suppressed',
        survives: () => verdictProperties(sample => sample === verdictSamples.sourceToSink
            ? makeDecision({ verdict: 'capability_review', severityCeiling: 'medium' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_direct_evidence_exceeds_ceiling',
        survives: () => verdictProperties(sample => sample === verdictSamples.directHigh
            ? makeDecision({ verdict: 'vulnerability', severityCeiling: 'critical', confidenceCeiling: 'confirmed', vulnerabilityBasis: directBasis })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_missing_control_as_expected',
        survives: () => verdictProperties(sample => sample === verdictSamples.missingExpected
            ? makeDecision({ verdict: 'expected_capability', severityCeiling: 'low', confidenceCeiling: 'confirmed' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_unknown_trust_as_expected',
        survives: () => verdictProperties(sample => sample === verdictSamples.unknownTrust
            ? makeDecision({ verdict: 'expected_capability', severityCeiling: 'low', confidenceCeiling: 'confirmed' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_review_can_be_critical',
        survives: () => verdictProperties(sample => sample === verdictSamples.presentUnverified
            ? makeDecision({ verdict: 'capability_review', severityCeiling: 'critical' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'verdict',
        id: 'verdict_ignores_context_unavailable',
        survives: () => verdictProperties(sample => sample === verdictSamples.unavailable
            ? makeDecision({ verdict: 'risky_configuration', severityCeiling: 'high', confidenceCeiling: 'confirmed' })
            : evaluateContextualVerdict(sample)).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_ignores_evidence_rule_mismatch',
        survives: () => bindingProperties(issue => filterErrors(validateContextualFindingPresentation(issue), [/evidence .* belongs/])).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_ignores_fix_rule_mismatch',
        survives: () => bindingProperties(issue => filterErrors(validateContextualFindingPresentation(issue), [/fix belongs/])).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_allows_secret_safe_pattern',
        survives: () => bindingProperties(issue => filterErrors(validateContextualFindingPresentation(issue), [/secret-handling remediation/])).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_allows_efficiency_security_category',
        survives: () => bindingProperties(issue => filterErrors(validateContextualFindingPresentation(issue), [/efficiency rule is presented/])).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_ignores_presentation_provenance',
        survives: () => bindingProperties(issue => filterErrors(validateContextualFindingPresentation(issue), [/issueRuleId belongs/])).length === 0,
    },
    {
        target: 'binding',
        id: 'binding_always_valid',
        survives: () => bindingProperties(() => ({ valid: true, errors: [] })).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_required_context',
        survives: () => invariantProperties((issue, ctx) => issue.context ? validateFindingInvariants(issue, ctx) : { valid: true, errors: [] }).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_critical_non_vulnerability',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/critical severity requires/])).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_needs_more_context_critical',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/needs_more_context cannot raise/])).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_vulnerability_basis',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/vulnerability.*basis|VulnerabilityBasis/i])).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_expected_control_effectiveness',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/expected_capability|present_unverified/])).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_unavailable_control_risk',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/unavailable controls/])).length === 0,
    },
    {
        target: 'invariants',
        id: 'invariant_ignores_decision_critical_non_vulnerability',
        survives: () => invariantProperties((issue, ctx) => filterErrors(validateFindingInvariants(issue, ctx), [/critical severity ceiling/])).length === 0,
    },
];

function runMutationTarget(target: Mutant['target']): MutationReport {
    const targetMutants = mutants.filter(mutant => mutant.target === target);
    const survivors = targetMutants.filter(mutant => mutant.survives()).map(mutant => mutant.id);
    const killed = targetMutants.length - survivors.length;
    return {
        target,
        total: targetMutants.length,
        killed,
        score: Number((killed / targetMutants.length).toFixed(4)),
        survivors,
    };
}

describe('contextual mutation harness', () => {
    it('kills verdict, binding, and invariant mutants above Gate 3.5 thresholds', () => {
        expect(verdictProperties(evaluateContextualVerdict)).toEqual([]);
        expect(bindingProperties(validateContextualFindingPresentation)).toEqual([]);
        expect(invariantProperties(validateFindingInvariants)).toEqual([]);

        const reports = [
            runMutationTarget('verdict'),
            runMutationTarget('binding'),
            runMutationTarget('invariants'),
        ];

        expect(reports).toEqual([
            { target: 'verdict', total: 10, killed: 10, score: 1, survivors: [] },
            { target: 'binding', total: 6, killed: 6, score: 1, survivors: [] },
            { target: 'invariants', total: 7, killed: 7, score: 1, survivors: [] },
        ]);
        expect(reports.find(report => report.target === 'verdict')!.score).toBeGreaterThanOrEqual(0.9);
        expect(reports.find(report => report.target === 'binding')!.score).toBeGreaterThanOrEqual(0.9);
        expect(reports.find(report => report.target === 'invariants')!.score).toBeGreaterThanOrEqual(0.85);
    });
});
