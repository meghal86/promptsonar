import type { DirectVulnerabilityAssessment, VerdictInput, VulnerabilityBasis } from './types';
import { isAcceptedVulnerabilityBasis } from './verdict';

export type SecretSemanticKind =
    | 'none'
    | 'secret_reference'
    | 'secret_availability'
    | 'hardcoded_secret'
    | 'secret_exposure'
    | 'secret_enumeration'
    | 'secret_exfiltration';

export interface SecretSemanticOptions {
    evidenceIds?: string[];
    untrustedInfluence?: boolean;
    reachesOutput?: boolean;
    reachesNetwork?: boolean;
    sourceToSinkBasis?: Extract<VulnerabilityBasis, { kind: 'source_to_sink' }>;
}

export interface SecretSemanticAssessment {
    kind: SecretSemanticKind;
    confidence: 'confirmed' | 'probable' | 'potential';
    evidenceIds: string[];
    reason: string;
}

const SECRET_NAME = '[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*';
const ENV_SECRET_REFERENCE = new RegExp([
    `\\bprocess\\.env\\.${SECRET_NAME}\\b`,
    `\\bprocess\\.env\\[['"\`]${SECRET_NAME}['"\`]\\]`,
    `\\bDeno\\.env\\.get\\(['"\`]${SECRET_NAME}['"\`]\\)`,
    `\\bos\\.environ(?:\\.get)?\\(['"\`]${SECRET_NAME}['"\`]\\)`,
    `\\bgetenv\\(['"\`]${SECRET_NAME}['"\`]\\)`,
].join('|'), 'i');

const HARDCODED_SECRET = /\b(?:sk-(?:live|test|proj|ant)-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/;
const SECRET_ENUMERATION = /\b(?:Object\.keys\s*\(\s*process\.env\s*\)|for\s*\([^)]*\bin\s+process\.env|env\b.*(?:enumerate|list|dump|print|show)|printenv|env\s*\|)/i;
const SECRET_EXFILTRATION = /\b(?:send|post|upload|exfiltrate|leak|forward)\b[\s\S]{0,120}\b(?:secret|token|credential|api[_-]?key|process\.env|env)\b/i;

export function isSecretReference(text: string): boolean {
    return ENV_SECRET_REFERENCE.test(text);
}

export function redactSecretReferences(text: string): string {
    return text.replace(new RegExp(ENV_SECRET_REFERENCE.source, 'gi'), '[SECRET_REFERENCE]');
}

export function isHardcodedSecretLiteral(text: string): boolean {
    return HARDCODED_SECRET.test(text);
}

export function classifySecretSemantics(text: string, options: SecretSemanticOptions = {}): SecretSemanticAssessment {
    const evidenceIds = options.evidenceIds || [];
    if (isHardcodedSecretLiteral(text)) {
        return {
            kind: 'hardcoded_secret',
            confidence: 'confirmed',
            evidenceIds,
            reason: 'A literal credential-like value is present.',
        };
    }
    if (SECRET_ENUMERATION.test(text)) {
        return {
            kind: 'secret_enumeration',
            confidence: options.untrustedInfluence ? 'probable' : 'potential',
            evidenceIds,
            reason: 'The content appears to enumerate environment or secret-bearing values.',
        };
    }
    if (SECRET_EXFILTRATION.test(text)) {
        return {
            kind: 'secret_exfiltration',
            confidence: options.untrustedInfluence && (options.reachesNetwork || options.reachesOutput) ? 'probable' : 'potential',
            evidenceIds,
            reason: 'The content appears to move secret-bearing values to an output or external destination.',
        };
    }
    if (isSecretReference(text)) {
        return {
            kind: 'secret_reference',
            confidence: 'confirmed',
            evidenceIds,
            reason: 'A named secret is referenced through an environment API, but no literal value is present.',
        };
    }
    if (/\b(?:secret|token|credential|api[_-]?key|password)\b/i.test(text)) {
        return {
            kind: 'secret_availability',
            confidence: 'potential',
            evidenceIds,
            reason: 'The content mentions secret-bearing data without proving exposure.',
        };
    }
    return {
        kind: 'none',
        confidence: 'potential',
        evidenceIds,
        reason: 'No secret semantics detected.',
    };
}

export function secretAssessmentToVerdictInput(
    assessment: SecretSemanticAssessment,
    options: SecretSemanticOptions = {},
): VerdictInput {
    const directVulnerability: DirectVulnerabilityAssessment = assessment.kind === 'hardcoded_secret'
        ? {
            present: true,
            ruleId: 'sec_hardcoded_secret',
            confidence: assessment.confidence,
            severityCeiling: 'high',
            basis: {
                kind: 'direct_evidence',
                directEvidenceClass: 'hardcoded_secret',
                evidenceIds: assessment.evidenceIds.length > 0 ? assessment.evidenceIds : ['secret-direct-evidence'],
            },
        }
        : { present: false };
    const sourceToSinkBasis = options.sourceToSinkBasis && isAcceptedVulnerabilityBasis(options.sourceToSinkBasis)
        ? options.sourceToSinkBasis
        : undefined;
    const pathBased = assessment.kind === 'secret_enumeration' || assessment.kind === 'secret_exfiltration' || assessment.kind === 'secret_exposure';

    return {
        capabilityPrivilege: assessment.kind === 'none' ? 'ordinary' : 'privileged',
        exposure: options.untrustedInfluence ? 'untrusted' : assessment.kind === 'secret_reference' ? 'trusted' : 'unknown',
        reachability: sourceToSinkBasis ? 'verified' : pathBased ? 'probable' : 'not_applicable',
        controlState: sourceToSinkBasis ? 'missing' : assessment.kind === 'secret_reference' ? 'present_unverified' : 'unavailable',
        contextAvailability: sourceToSinkBasis ? 'complete' : assessment.kind === 'secret_reference' ? 'partial' : 'unavailable',
        intent: assessment.kind === 'secret_reference' ? 'expected' : 'unknown',
        directVulnerability,
        sourceToSinkBasis,
    };
}
