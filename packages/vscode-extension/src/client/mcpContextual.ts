import {
    normalizeMcpAuditResultContextual,
    type Finding,
    type McpAuditResult,
} from '@promptsonar/core';

export function contextualizeMcpAuditForActiveDocument(mcpAudit: McpAuditResult): {
    mcpAudit: McpAuditResult;
    findings: Array<Finding & {
        context?: NonNullable<McpAuditResult['findings'][number]['context']>;
        evidence?: string;
        recommendation?: string;
        fix?: string;
        message?: string;
    }>;
} {
    const contextualAudit = normalizeMcpAuditResultContextual(mcpAudit);
    return {
        mcpAudit: contextualAudit,
        findings: contextualAudit.findings.map((finding) => ({
            rule_id: finding.rule_id,
            category: 'security',
            severity: finding.severity,
            explanation: finding.message,
            suggested_fix: finding.fix,
            workflow: finding.workflow,
            matchedText: finding.evidence,
            context: finding.context,
            evidence: finding.evidence,
            recommendation: finding.fix,
            fix: finding.fix,
            message: finding.message,
        })),
    };
}
