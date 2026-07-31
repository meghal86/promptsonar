import type { Severity } from '../rules/types';
import type { ArtifactKind } from '../artifacts';
export type { ArtifactKind } from '../artifacts';

export type CapabilityType =
    | 'shell'
    | 'filesystem.read'
    | 'filesystem.write'
    | 'network'
    | 'secret.read'
    | 'secret.write'
    | 'external_api'
    | 'database.read'
    | 'database.write'
    | 'deployment'
    | 'privileged_tool'
    | 'unknown';

export type TrustSource =
    | 'developer_instruction'
    | 'repository_code'
    | 'authenticated_admin'
    | 'user_input'
    | 'retrieved_content'
    | 'rag_document'
    | 'external_webhook'
    | 'email'
    | 'chat_message'
    | 'mcp_description'
    | 'memory'
    | 'unknown';

export type SecurityControl =
    | 'human_approval'
    | 'command_allowlist'
    | 'tool_allowlist'
    | 'argument_validation'
    | 'sandbox'
    | 'filesystem_scope'
    | 'read_only_scope'
    | 'authentication'
    | 'authorization'
    | 'network_allowlist'
    | 'secret_scope'
    | 'output_redaction'
    | 'rate_limit'
    | 'audit_log'
    | 'none_detected'
    | 'unknown';

export type ControlStatus =
    | 'effective'
    | 'present_unverified'
    | 'missing'
    | 'disabled'
    | 'bypassed'
    | 'contradicted'
    | 'unavailable';

export type ContextualConfidence = 'confirmed' | 'probable' | 'potential';

export interface ControlEvaluation {
    control: SecurityControl;
    status: ControlStatus;
    confidence: ContextualConfidence;
    evidenceIds: string[];
    reason?: string;
}

export interface ControlAssessment {
    evaluations: ControlEvaluation[];
    evaluationScope: 'complete' | 'partial' | 'not_available';
}

export type ContextualVerdict =
    | 'expected_capability'
    | 'capability_review'
    | 'risky_configuration'
    | 'vulnerability'
    | 'hardening_suggestion'
    | 'quality_suggestion'
    | 'needs_more_context';

export type VulnerabilityBasis =
    | {
        kind: 'source_to_sink';
        pathIds: string[];
        untrustedSourceEvidenceIds: string[];
        privilegedSinkEvidenceIds: string[];
        controlFailureEvidenceIds: string[];
    }
    | {
        kind: 'direct_evidence';
        directEvidenceClass:
            | 'hardcoded_secret'
            | 'authentication_disabled'
            | 'public_unauthenticated_privileged_endpoint'
            | 'authorization_wildcard'
            | 'direct_command_injection'
            | 'exposed_private_key'
            | 'other';
        evidenceIds: string[];
    };

export type DirectVulnerabilityAssessment =
    | { present: false }
    | {
        present: true;
        basis: Extract<VulnerabilityBasis, { kind: 'direct_evidence' }>;
        ruleId: string;
        confidence: ContextualConfidence;
        severityCeiling: Severity;
    };

export interface VerdictInput {
    capabilityPrivilege: 'ordinary' | 'sensitive' | 'privileged';
    exposure: 'trusted' | 'untrusted' | 'mixed' | 'unknown';
    reachability: 'verified' | 'probable' | 'not_verified' | 'not_applicable';
    controlState: ControlStatus;
    contextAvailability: 'complete' | 'partial' | 'unavailable';
    intent: 'expected' | 'unexpected' | 'unknown';
    directVulnerability: DirectVulnerabilityAssessment;
    sourceToSinkBasis?: Extract<VulnerabilityBasis, { kind: 'source_to_sink' }>;
}

export interface VerdictDecision {
    verdict: ContextualVerdict;
    severityCeiling: Severity;
    confidenceCeiling: ContextualConfidence;
    explanationCode: string;
    vulnerabilityBasis?: VulnerabilityBasis;
}

export interface CanonicalIssueContext {
    contextModelVersion?: string;
    artifactKind: ArtifactKind;
    capability?: CapabilityType;
    trustAssessment: {
        sources: TrustSource[];
        confidence: ContextualConfidence;
        evidenceIds: string[];
    };
    intentAssessment: {
        expected: boolean | 'unknown';
        reason?: string;
        source: 'inferred' | 'config' | 'user_profile' | 'unknown';
        confidence: ContextualConfidence;
        evidenceIds: string[];
    };
    controlAssessment: ControlAssessment;
    reachability: {
        pathIds: string[];
        confidence: ContextualConfidence;
        repositoryVerified: boolean;
    };
    vulnerabilityBasis?: VulnerabilityBasis;
    verdict: ContextualVerdict;
}

export interface CanonicalIssueEvidence {
    id: string;
    ruleId?: string;
    file?: string;
    line?: number;
    column?: number;
    snippet?: string;
    kind?: string;
}

export interface CanonicalAnalysisIssue {
    id: string;
    ruleId: string;
    severity: Severity | string;
    category: string;
    issue: string;
    impact: string;
    whyThisMatters: string;
    howToFix: string;
    evidence: CanonicalIssueEvidence[];
    context?: CanonicalIssueContext;
}
