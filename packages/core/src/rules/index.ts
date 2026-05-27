import { Finding, RuleInput, RuleResult, Severity } from './types';
import { checkClarity } from './clarity';
import { checkStructure } from './structure';
import { checkBestPractices } from './best_practices';
import { checkConsistency } from './consistency';
import { checkOwaspPatterns } from './security/owasp_patterns';
import { checkPii } from './security/pii';
import { checkTokenLimit } from './efficiency/token_limit';
import { checkUnboundedPersona } from './security/unbounded_persona';
import { checkUnboundedAccess } from './security/unbounded_access';
import { checkRagInjection } from './security/rag_injection';
import { checkEvasionPatterns } from './security/evasion';
import { checkWorkflowEscalation } from './security/workflow_escalation';
import { checkEthics } from './ethics';
import { inferWorkflowForFinding } from '../workflow';

export * from './types';

const severityRank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

function workflowPriority(finding: Finding): number {
    if (finding.rule_id === 'sec_workflow_escalation') return 0;
    if (finding.rule_id === 'sec_privileged_sink_access') return 1;
    if (finding.rule_id.startsWith('MCP-') || finding.rule_id === 'sec_mcp_tool_poisoning') return 2;
    if (finding.rule_id.includes('injection') || finding.rule_id.includes('llm01') || finding.rule_id.includes('homoglyph') || finding.rule_id.includes('evasion')) return 3;
    if (finding.rule_id === 'sec_rag_injection' || finding.workflow?.path?.nodes?.some(node => node.type === 'agent_memory' || node.type === 'retrieved_context')) return 4;
    return 5;
}

function upgradedSeverity(current: Severity, workflowRisk?: string): Severity {
    if (workflowRisk === 'critical') return 'critical';
    if (workflowRisk === 'high' && severityRank[current] > severityRank.high) return 'high';
    if (workflowRisk === 'medium' && severityRank[current] > severityRank.medium) return 'medium';
    return current;
}

function scoreFindings(findings: Finding[]): { score: number; status: 'pass' | 'warn' | 'fail' } {
    let totalPenalty = 0;
    for (const finding of findings) {
        if (finding.category === 'security') totalPenalty += (finding.penalty_score || 0) * 0.40;
        if (finding.category === 'clarity') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'structure') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'best_practices') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'consistency') totalPenalty += (finding.penalty_score || 0) * 0.10;
        if (finding.category === 'efficiency') totalPenalty += (finding.penalty_score || 0) * 0.05;
        if (finding.category === 'ethics') totalPenalty += (finding.penalty_score || 0) * 0.05;

        if (finding.workflow?.path?.privilegedSinkReached) {
            totalPenalty += finding.workflow.risk === 'critical' ? 22 : 14;
        } else if (finding.workflow?.path?.trustBoundaryCrossed) {
            totalPenalty += 8;
        }
    }

    let score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
    let status: 'pass' | 'warn' | 'fail' = score < 70 ? 'fail' : score < 85 ? 'warn' : 'pass';

    const hasCritical = findings.some(f => f.severity === 'critical');
    if (hasCritical) {
        score = Math.min(score, 49);
        status = 'fail';
    }

    const hasCriticalPrivilegedWorkflow = findings.some(f => f.workflow?.path?.privilegedSinkReached && f.workflow.risk === 'critical');
    if (hasCriticalPrivilegedWorkflow) {
        score = Math.min(score, 39);
        status = 'fail';
    }

    const hasHighRisk = findings.some(f =>
        f.severity === 'high' && (f.category === 'security' || f.category === 'ethics')
    );
    if (hasHighRisk) {
        score = Math.min(score, 69);
        status = 'fail';
    }

    const hasHighPrivilegedWorkflow = findings.some(f => f.workflow?.path?.privilegedSinkReached && f.workflow.risk === 'high');
    if (hasHighPrivilegedWorkflow) {
        score = Math.min(score, 59);
        status = 'fail';
    }

    const hasMediumRisk = findings.some(f =>
        f.severity === 'medium' && (f.category === 'security' || f.category === 'ethics')
    );
    if (hasMediumRisk && status === 'pass') {
        score = Math.min(score, 84);
        status = 'warn';
    }

    return { score, status };
}

export function evaluatePrompt(input: RuleInput, config: any = {}): RuleResult {
    const findings = [
        ...checkWorkflowEscalation(input),
        ...checkClarity(input),
        ...checkStructure(input),
        ...checkBestPractices(input),
        ...checkConsistency(input),
        ...checkOwaspPatterns(input),
        ...checkEvasionPatterns(input),
        ...checkPii(input),
        ...checkUnboundedPersona(input),
        ...checkUnboundedAccess(input),
        ...checkRagInjection(input),
        ...checkEthics(input),
        ...checkTokenLimit(input, config?.efficiency?.token_budget || 8192),
    ];

    const enrichedFindings = findings.map(f => {
        const workflow = f.category === 'security' || f.category === 'ethics'
            ? inferWorkflowForFinding({
                ruleId: f.rule_id,
                severity: f.severity,
                text: input.text,
                content: input.text,
                filePath: input.context.filePath,
            })
            : undefined;
        return workflow
            ? { ...f, severity: upgradedSeverity(f.severity, workflow.risk), workflow }
            : f;
    }).sort((a, b) => {
        const priorityDelta = workflowPriority(a) - workflowPriority(b);
        if (priorityDelta !== 0) return priorityDelta;
        const severityDelta = severityRank[a.severity] - severityRank[b.severity];
        if (severityDelta !== 0) return severityDelta;
        return a.rule_id.localeCompare(b.rule_id);
    });

    const { score, status } = scoreFindings(enrichedFindings);

    const cleanFindings = enrichedFindings.map(f => {
        const { penalty_score, ...rest } = f;
        return rest;
    });

    return {
        score,
        status,
        findings: cleanFindings as any
    };
}
