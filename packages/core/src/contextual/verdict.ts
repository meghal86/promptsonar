import type {
    ContextualConfidence,
    ContextualVerdict,
    ControlStatus,
    DirectVulnerabilityAssessment,
    VerdictDecision,
    VerdictInput,
    VulnerabilityBasis,
} from './types';

export const CAPABILITY_PRIVILEGES = ['ordinary', 'sensitive', 'privileged'] as const;
export const EXPOSURES = ['trusted', 'untrusted', 'mixed', 'unknown'] as const;
export const REACHABILITIES = ['verified', 'probable', 'not_verified', 'not_applicable'] as const;
export const CONTROL_STATES = ['effective', 'present_unverified', 'missing', 'disabled', 'bypassed', 'contradicted', 'unavailable'] as const;
export const CONTEXT_AVAILABILITIES = ['complete', 'partial', 'unavailable'] as const;
export const INTENTS = ['expected', 'unexpected', 'unknown'] as const;
export const CONTEXTUAL_VERDICTS = [
    'expected_capability',
    'capability_review',
    'risky_configuration',
    'vulnerability',
    'hardening_suggestion',
    'quality_suggestion',
    'needs_more_context',
] as const satisfies readonly ContextualVerdict[];

const CONTROL_FAILURE_STATES = new Set<ControlStatus>(['missing', 'disabled', 'bypassed', 'contradicted']);
const CONTEXTUAL_CONFIDENCES = new Set<ContextualConfidence>(['confirmed', 'probable', 'potential']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function hasNonEmptyEvidenceIds(value: unknown): value is string[] {
    return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string' && item.length > 0);
}

export function isAcceptedVulnerabilityBasis(basis: VulnerabilityBasis | undefined): basis is VulnerabilityBasis {
    if (!basis) return false;
    if (basis.kind === 'source_to_sink') {
        return hasNonEmptyEvidenceIds((basis as any).pathIds)
            && hasNonEmptyEvidenceIds((basis as any).untrustedSourceEvidenceIds)
            && hasNonEmptyEvidenceIds((basis as any).privilegedSinkEvidenceIds)
            && hasNonEmptyEvidenceIds((basis as any).controlFailureEvidenceIds);
    }
    return hasNonEmptyEvidenceIds((basis as any).evidenceIds);
}

export function isValidDirectVulnerabilityAssessment(assessment: DirectVulnerabilityAssessment): boolean {
    if (!assessment.present) return true;
    return Boolean(assessment.ruleId)
        && CONTEXTUAL_CONFIDENCES.has(assessment.confidence)
        && SEVERITIES.has(assessment.severityCeiling)
        && isAcceptedVulnerabilityBasis(assessment.basis);
}

function hasPrivilegedCapability(input: VerdictInput): boolean {
    return input.capabilityPrivilege === 'sensitive' || input.capabilityPrivilege === 'privileged';
}

function sourceToSinkVulnerabilityApplies(input: VerdictInput): boolean {
    return input.capabilityPrivilege === 'privileged'
        && input.exposure !== 'trusted'
        && (input.reachability === 'verified' || input.reachability === 'probable')
        && CONTROL_FAILURE_STATES.has(input.controlState)
        && input.contextAvailability !== 'unavailable'
        && isAcceptedVulnerabilityBasis(input.sourceToSinkBasis);
}

function sourceToSinkConfidence(input: VerdictInput): ContextualConfidence {
    if (input.reachability === 'verified' && input.exposure !== 'unknown') return 'confirmed';
    return 'probable';
}

/**
 * Verdict precedence is fixed and intentional:
 * vulnerability > risky_configuration > needs_more_context > capability_review
 * > hardening_suggestion/quality_suggestion > expected_capability.
 *
 * Capability kind alone never selects vulnerability. A vulnerability verdict
 * requires an accepted source-to-sink basis or an accepted rule-specific direct
 * evidence basis.
 */
export function evaluateContextualVerdict(input: VerdictInput): VerdictDecision {
    const normalizedInput = (input || {}) as VerdictInput;
    const directVulnerability = normalizedInput.directVulnerability || { present: false };

    if (directVulnerability.present && isValidDirectVulnerabilityAssessment(directVulnerability)) {
        return {
            verdict: 'vulnerability',
            severityCeiling: directVulnerability.severityCeiling,
            confidenceCeiling: directVulnerability.confidence,
            explanationCode: 'direct_evidence_vulnerability',
            vulnerabilityBasis: directVulnerability.basis,
        };
    }

    if (sourceToSinkVulnerabilityApplies(normalizedInput)) {
        return {
            verdict: 'vulnerability',
            severityCeiling: 'critical',
            confidenceCeiling: sourceToSinkConfidence(normalizedInput),
            explanationCode: 'source_to_sink_vulnerability',
            vulnerabilityBasis: normalizedInput.sourceToSinkBasis,
        };
    }

    if (
        normalizedInput.intent === 'expected'
        && hasPrivilegedCapability(normalizedInput)
        && CONTROL_FAILURE_STATES.has(normalizedInput.controlState)
        && normalizedInput.contextAvailability !== 'unavailable'
    ) {
        return {
            verdict: 'risky_configuration',
            severityCeiling: 'high',
            confidenceCeiling: normalizedInput.controlState === 'missing' ? 'probable' : 'confirmed',
            explanationCode: `expected_capability_control_${normalizedInput.controlState}`,
        };
    }

    if (normalizedInput.contextAvailability === 'unavailable' || normalizedInput.controlState === 'unavailable') {
        return {
            verdict: 'needs_more_context',
            severityCeiling: 'low',
            confidenceCeiling: 'potential',
            explanationCode: 'required_context_unavailable',
        };
    }

    if (
        hasPrivilegedCapability(normalizedInput)
        && normalizedInput.intent === 'expected'
        && normalizedInput.exposure === 'trusted'
        && (normalizedInput.reachability === 'verified' || normalizedInput.reachability === 'not_applicable')
        && normalizedInput.controlState === 'effective'
        && normalizedInput.contextAvailability === 'complete'
    ) {
        return {
            verdict: 'expected_capability',
            severityCeiling: 'low',
            confidenceCeiling: 'confirmed',
            explanationCode: 'expected_capability_controls_effective',
        };
    }

    if (hasPrivilegedCapability(normalizedInput)) {
        return {
            verdict: 'capability_review',
            severityCeiling: normalizedInput.capabilityPrivilege === 'privileged' ? 'medium' : 'low',
            confidenceCeiling: normalizedInput.exposure === 'unknown' || normalizedInput.controlState === 'present_unverified' ? 'potential' : 'probable',
            explanationCode: 'privileged_capability_requires_review',
        };
    }

    if (normalizedInput.intent === 'unexpected' || CONTROL_FAILURE_STATES.has(normalizedInput.controlState)) {
        return {
            verdict: 'hardening_suggestion',
            severityCeiling: 'low',
            confidenceCeiling: 'probable',
            explanationCode: 'ordinary_capability_hardening',
        };
    }

    return {
        verdict: 'quality_suggestion',
        severityCeiling: 'low',
        confidenceCeiling: 'potential',
        explanationCode: 'ordinary_capability_quality',
    };
}
