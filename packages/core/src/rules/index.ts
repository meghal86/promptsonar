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
import {
    inferArtifactKind,
    inferExecutionIntent,
    type ArtifactKind,
    type ExecutionIntent,
} from '../artifacts';

export * from './types';
export { scanContentForSecrets, type ContentSecretMatch } from './security/pii';

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

const PROMPT_QUALITY_ARTIFACTS: ReadonlySet<ArtifactKind> = new Set(['prompt', 'claude', 'agents', 'agent', 'skill']);
const SECURITY_ARTIFACTS: ReadonlySet<ArtifactKind> = new Set([
    'prompt',
    'claude',
    'agents',
    'agent',
    'skill',
    'workflow',
    'mcp',
    'mcp_config',
    'mcp_server',
    'tool',
    'tool_router',
    'router',
    'deployment_config',
    'documentation',
    'test',
    'fixture',
    'example',
    'source',
    'unknown',
]);

const RULE_SUPPORTED_ARTIFACTS: Record<string, ReadonlySet<ArtifactKind>> = {
    clarity_missing_quantifier: PROMPT_QUALITY_ARTIFACTS,
    clarity_open_ended: PROMPT_QUALITY_ARTIFACTS,
    clarity_vague_words: PROMPT_QUALITY_ARTIFACTS,
    struct_missing_format_enforcer: PROMPT_QUALITY_ARTIFACTS,
    bp_missing_persona: PROMPT_QUALITY_ARTIFACTS,
    bp_missing_few_shot: PROMPT_QUALITY_ARTIFACTS,
    bp_missing_cot: PROMPT_QUALITY_ARTIFACTS,
    consist_contradiction: PROMPT_QUALITY_ARTIFACTS,
    eff_token_budget: PROMPT_QUALITY_ARTIFACTS,
    eff_token_bloat: PROMPT_QUALITY_ARTIFACTS,
    eff_compression_potential: PROMPT_QUALITY_ARTIFACTS,
    sec_workflow_escalation: SECURITY_ARTIFACTS,
    sec_privileged_sink_access: SECURITY_ARTIFACTS,
    sec_owasp_llm01_injection: SECURITY_ARTIFACTS,
    sec_owasp_llm02_pii: SECURITY_ARTIFACTS,
    sec_unbounded_persona: SECURITY_ARTIFACTS,
    sec_unbounded_access: SECURITY_ARTIFACTS,
    sec_rag_injection: SECURITY_ARTIFACTS,
    sec_base64_encoded_payload: SECURITY_ARTIFACTS,
    sec_zero_width_injection: SECURITY_ARTIFACTS,
    sec_homoglyph_evasion: SECURITY_ARTIFACTS,
    sec_unicode_math_homoglyph: SECURITY_ARTIFACTS,
    sec_unicode_enclosed_obfuscation: SECURITY_ARTIFACTS,
    sec_unicode_injection_obfuscation: SECURITY_ARTIFACTS,
    ethics_bias_indicator: SECURITY_ARTIFACTS,
    ethics_manipulation: SECURITY_ARTIFACTS,
};

function isPromptQualityFinding(finding: Finding): boolean {
    return ['clarity', 'structure', 'best_practices', 'consistency', 'efficiency'].includes(finding.category);
}

function isAgentInstructionArtifact(artifactKind: ArtifactKind): boolean {
    return artifactKind === 'claude' || artifactKind === 'agents' || artifactKind === 'agent' || artifactKind === 'skill';
}

function effectiveArtifactContext(input: RuleInput): { artifactKind: ArtifactKind; executionIntent: ExecutionIntent; hasExplicitPromptBlock: boolean } {
    const inferredKind = inferArtifactKind(input.context.filePath);
    const artifactKind = input.context.artifactKind || (inferredKind === 'source' ? 'prompt' : inferredKind);
    const executionIntent = input.context.executionIntent || inferExecutionIntent(input.context.filePath, artifactKind);
    return {
        artifactKind,
        executionIntent,
        hasExplicitPromptBlock: Boolean(input.context.hasExplicitPromptBlock),
    };
}

function isRuleEligible(finding: Finding, artifactKind: ArtifactKind, executionIntent: ExecutionIntent, hasExplicitPromptBlock: boolean): boolean {
    const supportedArtifacts = RULE_SUPPORTED_ARTIFACTS[finding.rule_id];
    if (isPromptQualityFinding(finding)) {
        if (executionIntent !== 'executable') return false;
        if (artifactKind === 'workflow') return hasExplicitPromptBlock;
        return supportedArtifacts ? supportedArtifacts.has(artifactKind) : PROMPT_QUALITY_ARTIFACTS.has(artifactKind);
    }
    return supportedArtifacts ? supportedArtifacts.has(artifactKind) : true;
}

function findingPriorityBand(finding: Finding): number {
    const verdict = finding.workflow?.path?.privilegedSinkReached ? 'vulnerability' : undefined;
    if (finding.severity === 'critical' || verdict === 'vulnerability') return 0;
    if (finding.category === 'security' && finding.severity === 'high') return 1;
    if (finding.category === 'security') return 2;
    if (finding.category === 'ethics') return 4;
    if (isPromptQualityFinding(finding)) return 5;
    return 4;
}

function upgradedSeverity(current: Severity, workflowRisk?: string): Severity {
    if (workflowRisk === 'critical') return 'critical';
    if (workflowRisk === 'high' && severityRank[current] > severityRank.high) return 'high';
    if (workflowRisk === 'medium' && severityRank[current] > severityRank.medium) return 'medium';
    return current;
}

function capSeverityForArtifact(finding: Finding, artifactKind: ArtifactKind, executionIntent: ExecutionIntent): Finding {
    if ((executionIntent === 'reference' || executionIntent === 'test_fixture') && finding.category === 'security') {
        return { ...finding, severity: 'low' };
    }
    if (isAgentInstructionArtifact(artifactKind) && finding.category === 'efficiency') {
        return { ...finding, severity: 'low' };
    }
    return finding;
}

function scoreFindings(findings: Finding[]): { score: number; status: 'pass' | 'warn' | 'fail' } {
    const severityTotals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const severityCaps: Record<Severity, number> = { critical: 80, high: 60, medium: 40, low: 20 };
    const categoryTotals: Record<string, number> = {};
    const categoryCaps: Record<string, number> = {
        security: 85,
        ethics: 40,
        clarity: 25,
        structure: 20,
        best_practices: 15,
        consistency: 15,
        efficiency: 15,
    };

    for (const finding of findings) {
        const penalty = finding.category === 'best_practices'
            ? 0.25
            : finding.severity === 'critical'
                ? 25
                : finding.severity === 'high'
                    ? 12
                    : finding.severity === 'medium'
                        ? 5
                        : 1;
        severityTotals[finding.severity] += penalty;
        categoryTotals[finding.category] = (categoryTotals[finding.category] || 0) + penalty;

        if (finding.workflow?.path?.privilegedSinkReached) {
            categoryTotals.security = (categoryTotals.security || 0) + (finding.workflow.risk === 'critical' ? 20 : 12);
        } else if (finding.workflow?.path?.trustBoundaryCrossed) {
            categoryTotals.security = (categoryTotals.security || 0) + 6;
        }
    }

    const severityPenalty = Object.entries(severityTotals)
        .reduce((total, [severity, value]) => total + Math.min(value, severityCaps[severity as Severity]), 0);
    const categoryPenalty = Object.entries(categoryTotals)
        .reduce((total, [category, value]) => total + Math.min(value, categoryCaps[category] ?? 20), 0);
    let score = Math.max(0, Math.min(100, Math.round(100 - Math.min(severityPenalty, categoryPenalty))));
    let status: 'pass' | 'warn' | 'fail' = score < 70 ? 'fail' : score < 85 ? 'warn' : 'pass';

    const criticalCount = findings.filter(f => f.severity === 'critical').length;
    const highCount = findings.filter(f => f.severity === 'high').length;
    if (criticalCount >= 2) {
        score = Math.min(score, 40);
        status = 'fail';
    } else if (criticalCount === 1) {
        score = Math.min(score, 60);
        status = 'fail';
    }

    if (highCount >= 5) {
        score = Math.min(score, 65);
        status = 'fail';
    } else if (highCount >= 3) {
        score = Math.min(score, 75);
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

    if (findings.length >= 1000) score = Math.min(score, 55);
    else if (findings.length >= 500) score = Math.min(score, 65);
    else if (findings.length >= 100) score = Math.min(score, 80);
    else if (findings.length >= 25) score = Math.min(score, 85);
    else if (findings.length >= 10) score = Math.min(score, 90);
    if (score < 70) status = 'fail';
    else if (score < 85 && status === 'pass') status = 'warn';

    return { score, status };
}

export function evaluatePrompt(input: RuleInput, config: any = {}): RuleResult {
    const artifactContext = effectiveArtifactContext(input);
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
    ].filter(finding => isRuleEligible(
        finding,
        artifactContext.artifactKind,
        artifactContext.executionIntent,
        artifactContext.hasExplicitPromptBlock,
    ));

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
        const enriched = workflow
            ? { ...f, severity: upgradedSeverity(f.severity, workflow.risk), workflow }
            : f;
        return capSeverityForArtifact(enriched, artifactContext.artifactKind, artifactContext.executionIntent);
    }).sort((a, b) => {
        const bandDelta = findingPriorityBand(a) - findingPriorityBand(b);
        if (bandDelta !== 0) return bandDelta;
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
