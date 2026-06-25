import {
    evaluateContextualVerdict,
    inferCapabilityIntent,
    type ArtifactKind,
    type CanonicalIssueContext,
    type CapabilityType,
    type ContextualConfidence,
    type ControlStatus,
    type SecurityControl,
    type VerdictInput,
    type VulnerabilityBasis,
} from '../contextual';
import type { McpAuditResult, McpFinding, McpSeverity } from './auditor';

export type ContextualMcpFinding = McpFinding & {
    context?: CanonicalIssueContext;
};

const CAPABILITY_ONLY_MCP_RULE_IDS = new Set(['MCP-103', 'MCP-104', 'MCP-105']);
const CONTROL_FAILURE_MCP_RULE_IDS = new Set(['MCP-002', 'MCP-003', 'MCP-008', 'MCP-011', 'MCP-012', 'MCP-013', 'MCP-014']);
const DIRECT_VULNERABILITY_MCP_RULE_IDS = new Set(['MCP-001', 'MCP-005']);
const COMPOSITE_VULNERABILITY_MCP_RULE_IDS = new Set(['MCP-108', 'MCP-109']);

const SEVERITY_RANK: Record<McpSeverity, number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
};

function evidenceIdForMcpFinding(finding: McpFinding): string {
    return [
        'mcp',
        finding.rule_id,
        finding.server || 'config',
        finding.line || 1,
        finding.column || 1,
    ].join(':');
}

function capabilityForMcpFinding(finding: McpFinding): CapabilityType {
    const signal = `${finding.rule_id} ${finding.message || ''} ${finding.evidence || ''} ${finding.fix || ''}`.toLowerCase();
    if (finding.rule_id === 'MCP-104') return 'shell';
    if (finding.rule_id === 'MCP-103') return /write|delete|modify/.test(signal) ? 'filesystem.write' : 'filesystem.read';
    if (finding.rule_id === 'MCP-105') return 'network';
    if (finding.rule_id === 'MCP-005' || finding.rule_id === 'MCP-013' || /secret|credential|token|api[_-]?key/.test(signal)) return 'secret.read';
    if (finding.rule_id === 'MCP-008' || /write|delete|modify/.test(signal)) return 'filesystem.write';
    if (/shell|process execution|command|exec/.test(signal)) return 'shell';
    if (/network|http|https|url|remote|domain/.test(signal)) return 'network';
    return 'privileged_tool';
}

function capabilityPrivilege(capability: CapabilityType): VerdictInput['capabilityPrivilege'] {
    if (
        capability === 'shell'
        || capability === 'filesystem.write'
        || capability === 'secret.read'
        || capability === 'secret.write'
        || capability === 'database.write'
        || capability === 'deployment'
        || capability === 'privileged_tool'
    ) {
        return 'privileged';
    }
    if (
        capability === 'filesystem.read'
        || capability === 'network'
        || capability === 'external_api'
        || capability === 'database.read'
    ) {
        return 'sensitive';
    }
    return 'ordinary';
}

function controlStateForMcpFinding(finding: McpFinding): ControlStatus {
    if (CAPABILITY_ONLY_MCP_RULE_IDS.has(finding.rule_id)) return 'unavailable';
    if (finding.rule_id === 'MCP-011' || finding.rule_id === 'MCP-109') return 'bypassed';
    if (CONTROL_FAILURE_MCP_RULE_IDS.has(finding.rule_id) || finding.rule_id === 'MCP-108') return 'missing';

    const signal = `${finding.message || ''} ${finding.evidence || ''} ${finding.fix || ''}`.toLowerCase();
    if (/bypass|auto.?execute|auto.?approve|without approval|skip confirmation/.test(signal)) return 'bypassed';
    if (/wildcard|unrestricted|broad|missing auth|unauthenticated|all scopes|all files/.test(signal)) return 'missing';
    return 'unavailable';
}

function requiredControlsForCapability(capability: CapabilityType): SecurityControl[] {
    if (capability === 'shell') return ['human_approval', 'command_allowlist', 'argument_validation', 'sandbox'];
    if (capability === 'filesystem.write') return ['filesystem_scope', 'human_approval', 'sandbox'];
    if (capability === 'filesystem.read') return ['filesystem_scope', 'read_only_scope'];
    if (capability === 'network' || capability === 'external_api') return ['network_allowlist', 'authentication'];
    if (capability === 'secret.read' || capability === 'secret.write') return ['secret_scope', 'output_redaction'];
    return ['tool_allowlist', 'human_approval'];
}

function directVulnerabilityBasisForMcpFinding(
    finding: McpFinding,
    evidenceIds: string[],
): VerdictInput['directVulnerability'] {
    if (finding.rule_id === 'MCP-005') {
        return {
            present: true,
            ruleId: finding.rule_id,
            confidence: 'confirmed',
            severityCeiling: 'high',
            basis: {
                kind: 'direct_evidence',
                directEvidenceClass: 'hardcoded_secret',
                evidenceIds,
            },
        };
    }

    if (finding.rule_id === 'MCP-001') {
        return {
            present: true,
            ruleId: finding.rule_id,
            confidence: 'probable',
            severityCeiling: 'critical',
            basis: {
                kind: 'direct_evidence',
                directEvidenceClass: 'public_unauthenticated_privileged_endpoint',
                evidenceIds,
            },
        };
    }

    return { present: false };
}

function sourceToSinkBasisForMcpFinding(
    finding: McpFinding,
    evidenceIds: string[],
    controlState: ControlStatus,
): Extract<VulnerabilityBasis, { kind: 'source_to_sink' }> | undefined {
    const acceptedControlFailure = ['missing', 'disabled', 'bypassed', 'contradicted'].includes(controlState);
    const workflowPathApplies = Boolean(
        finding.workflow?.path?.privilegedSinkReached
        && finding.workflow.path.trustBoundaryCrossed
        && acceptedControlFailure,
    );
    const directCompositeApplies = (finding.rule_id === 'MCP-108' || finding.rule_id === 'MCP-109') && acceptedControlFailure;
    if (!workflowPathApplies && !directCompositeApplies) return undefined;

    const workflowEvidenceIds = finding.workflow?.evidence?.map(item => item.id).filter(Boolean) || [];
    const basisEvidenceIds = workflowEvidenceIds.length > 0 ? workflowEvidenceIds : evidenceIds;
    return {
        kind: 'source_to_sink',
        pathIds: [`mcp:${finding.server || finding.path || finding.rule_id}`],
        untrustedSourceEvidenceIds: basisEvidenceIds,
        privilegedSinkEvidenceIds: basisEvidenceIds,
        controlFailureEvidenceIds: evidenceIds,
    };
}

function capSeverity(rawSeverity: McpSeverity, ceiling: McpSeverity): McpSeverity {
    return SEVERITY_RANK[rawSeverity] > SEVERITY_RANK[ceiling] ? ceiling : rawSeverity;
}

function confidenceForControlState(controlState: ControlStatus): ContextualConfidence {
    if (controlState === 'effective') return 'confirmed';
    if (controlState === 'unavailable') return 'potential';
    return 'probable';
}

function statusFromMcpFindings(findings: McpFinding[]): McpAuditResult['status'] {
    if (findings.some(finding => finding.severity === 'critical' || finding.severity === 'high')) return 'fail';
    if (findings.length > 0) return 'warn';
    return 'pass';
}

export function normalizeMcpFindingContextual(finding: McpFinding): ContextualMcpFinding {
    if (
        !CAPABILITY_ONLY_MCP_RULE_IDS.has(finding.rule_id)
        && !DIRECT_VULNERABILITY_MCP_RULE_IDS.has(finding.rule_id)
        && !COMPOSITE_VULNERABILITY_MCP_RULE_IDS.has(finding.rule_id)
    ) {
        return finding;
    }

    const evidenceIds = [evidenceIdForMcpFinding(finding)];
    const artifactKind: ArtifactKind = 'mcp_config';
    const capability = capabilityForMcpFinding(finding);
    const controlState = controlStateForMcpFinding(finding);
    const sourceToSinkBasis = sourceToSinkBasisForMcpFinding(finding, evidenceIds, controlState);
    const directVulnerability = directVulnerabilityBasisForMcpFinding(finding, evidenceIds);
    const intentAssessment = inferCapabilityIntent({
        artifactKind,
        capability,
        evidenceIds,
    });
    const verdictInput: VerdictInput = {
        capabilityPrivilege: capabilityPrivilege(capability),
        exposure: sourceToSinkBasis ? 'untrusted' : 'unknown',
        reachability: sourceToSinkBasis ? 'probable' : 'not_verified',
        controlState,
        contextAvailability: controlState === 'unavailable' ? 'unavailable' : 'complete',
        intent: intentAssessment.expected === true ? 'expected' : intentAssessment.expected === false ? 'unexpected' : 'unknown',
        directVulnerability,
        sourceToSinkBasis,
    };
    const decision = evaluateContextualVerdict(verdictInput);
    const controls = requiredControlsForCapability(capability);
    const context: CanonicalIssueContext = {
        artifactKind,
        capability,
        trustAssessment: {
            sources: sourceToSinkBasis ? ['user_input'] : ['unknown'],
            confidence: sourceToSinkBasis ? 'probable' : 'potential',
            evidenceIds: sourceToSinkBasis ? evidenceIds : [],
        },
        intentAssessment,
        controlAssessment: {
            evaluationScope: controlState === 'unavailable' ? 'not_available' : 'partial',
            evaluations: controls.map(control => ({
                control,
                status: controlState,
                confidence: confidenceForControlState(controlState),
                evidenceIds: controlState === 'unavailable' ? [] : evidenceIds,
                reason: controlState === 'unavailable'
                    ? 'Control enforcement was not available in the current MCP analysis context.'
                    : undefined,
            })),
        },
        reachability: {
            pathIds: sourceToSinkBasis?.pathIds || [],
            confidence: sourceToSinkBasis ? 'probable' : 'potential',
            repositoryVerified: Boolean(sourceToSinkBasis),
        },
        vulnerabilityBasis: decision.vulnerabilityBasis,
        verdict: decision.verdict,
    };

    return {
        ...finding,
        severity: capSeverity(finding.severity, decision.severityCeiling as McpSeverity),
        context,
    };
}

export function normalizeMcpAuditResultContextual(result: McpAuditResult): McpAuditResult {
    const findings = result.findings.map(finding => normalizeMcpFindingContextual(finding));
    return {
        ...result,
        findings,
        status: statusFromMcpFindings(findings),
    };
}

export function normalizeMcpAuditResultsContextual(results: McpAuditResult[]): McpAuditResult[] {
    return results.map(result => normalizeMcpAuditResultContextual(result));
}
