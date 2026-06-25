import type {
    CanonicalAnalysisIssue,
    ContextualVerdict,
    VerdictDecision,
    VerdictInput,
} from './types';
import { validateContextualFindingPresentation } from './presentation';
import { isAcceptedVulnerabilityBasis } from './verdict';

export interface FindingInvariantContext {
    requireContext?: boolean;
    verdictInput?: VerdictInput;
    decision?: VerdictDecision;
}

export interface FindingInvariantValidation {
    valid: boolean;
    errors: string[];
}

const HIGH_CONFIDENCE_VERDICTS = new Set<ContextualVerdict>(['vulnerability', 'risky_configuration']);

function normalizedSeverity(severity: string): 'low' | 'medium' | 'high' | 'critical' | 'unknown' {
    if (severity === 'low' || severity === 'medium' || severity === 'high' || severity === 'critical') return severity;
    return 'unknown';
}

function validateContextSeverity(finding: CanonicalAnalysisIssue, errors: string[]): void {
    const context = finding.context;
    if (!context) return;
    const severity = normalizedSeverity(String(finding.severity).toLowerCase());

    if (severity === 'critical' && context.verdict !== 'vulnerability') {
        errors.push('critical severity requires vulnerability verdict when contextual data is present');
    }
    if (context.verdict === 'needs_more_context' && (severity === 'high' || severity === 'critical')) {
        errors.push('needs_more_context cannot raise severity to high or critical');
    }
}

function validateContextBasis(finding: CanonicalAnalysisIssue, errors: string[]): void {
    const context = finding.context;
    if (!context) return;
    if (context.verdict === 'vulnerability' && !isAcceptedVulnerabilityBasis(context.vulnerabilityBasis)) {
        errors.push('vulnerability requires an accepted VulnerabilityBasis');
    }
    if (context.vulnerabilityBasis && !isAcceptedVulnerabilityBasis(context.vulnerabilityBasis)) {
        errors.push('VulnerabilityBasis is incomplete');
    }
}

function validateControlHonesty(finding: CanonicalAnalysisIssue, errors: string[]): void {
    const context = finding.context;
    if (!context) return;
    const statuses = context.controlAssessment.evaluations.map(evaluation => evaluation.status);
    const hasUnavailableControl = statuses.includes('unavailable');
    const hasPresentUnverifiedControl = statuses.includes('present_unverified');
    const hasEffectiveControl = statuses.includes('effective');
    const directEvidence = context.vulnerabilityBasis?.kind === 'direct_evidence';

    if (context.verdict === 'expected_capability' && (!hasEffectiveControl || statuses.some(status => status !== 'effective'))) {
        errors.push('expected_capability requires only effective control evaluations');
    }
    if (context.verdict === 'expected_capability' && hasPresentUnverifiedControl) {
        errors.push('present_unverified controls cannot satisfy expected_capability');
    }
    if (hasUnavailableControl && HIGH_CONFIDENCE_VERDICTS.has(context.verdict) && !directEvidence) {
        errors.push('unavailable controls cannot support vulnerability or risky_configuration without direct evidence');
    }
}

function validateVerdictDecision(decision: VerdictDecision | undefined, errors: string[]): void {
    if (!decision) return;
    if (decision.verdict === 'vulnerability' && !isAcceptedVulnerabilityBasis(decision.vulnerabilityBasis)) {
        errors.push('verdict decision vulnerability requires an accepted VulnerabilityBasis');
    }
    if (decision.verdict !== 'vulnerability' && decision.severityCeiling === 'critical') {
        errors.push('critical severity ceiling requires vulnerability verdict');
    }
}

function validateVerdictInput(input: VerdictInput | undefined, decision: VerdictDecision | undefined, errors: string[]): void {
    if (!input || !decision) return;
    const directEvidenceBasis = decision.vulnerabilityBasis?.kind === 'direct_evidence';
    if (input.controlState === 'unavailable' && decision.verdict !== 'needs_more_context' && !directEvidenceBasis) {
        errors.push('unavailable controls must produce needs_more_context');
    }
    if (input.controlState === 'present_unverified' && decision.verdict === 'expected_capability') {
        errors.push('present_unverified controls cannot produce expected_capability');
    }
    if (
        input.capabilityPrivilege === 'privileged'
        && decision.verdict === 'vulnerability'
        && !isAcceptedVulnerabilityBasis(decision.vulnerabilityBasis)
    ) {
        errors.push('privileged capability alone cannot produce vulnerability');
    }
}

export function validateFindingInvariants(
    finding: CanonicalAnalysisIssue,
    context: FindingInvariantContext = {},
): FindingInvariantValidation {
    const errors: string[] = [];
    const presentation = validateContextualFindingPresentation(finding);
    errors.push(...presentation.errors);

    if (context.requireContext && !finding.context) {
        errors.push('context is required for this invariant check');
    }

    validateContextSeverity(finding, errors);
    validateContextBasis(finding, errors);
    validateControlHonesty(finding, errors);
    validateVerdictDecision(context.decision, errors);
    validateVerdictInput(context.verdictInput, context.decision, errors);

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function assertFindingInvariants(
    finding: CanonicalAnalysisIssue,
    context: FindingInvariantContext = {},
): void {
    const validation = validateFindingInvariants(finding, context);
    if (!validation.valid) {
        throw new Error(`Finding invariant violation: ${validation.errors.join('; ')}`);
    }
}
