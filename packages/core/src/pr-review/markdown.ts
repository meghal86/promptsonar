import { analyzeRootCause, workflowPathSummary } from '../workflow';
import type { Finding } from '../rules/types';
import type { WorkflowDiff } from '../workflow/types';

export interface PrReviewSummaryInput {
    filesScanned: number;
    counts: { critical: number; high: number; medium: number };
    executionPaths: string[];
    confidence?: { score: number; level: string };
    rootCause?: { name: string; supporting: string[] };
    mcpRisk?: { score: number; severity: string; capabilities: string[]; approvalMode?: string };
    provenanceEvidence?: string[];
    workflowDiffs: Array<{
        filePath: string;
        before?: string;
        after?: string;
        introduced?: boolean;
        removed?: boolean;
        riskReduction?: number;
        diff?: WorkflowDiff;
    }>;
}

export function buildPrReviewSummaryMarkdown(input: PrReviewSummaryInput): string {
    const header = '## PromptSonar Review\n\n';
    const files = `**Files Scanned:** ${input.filesScanned}\n\n`;
    const findings = [
        `**Findings:**`,
        `- ${input.counts.critical} Critical`,
        `- ${input.counts.high} High`,
        `- ${input.counts.medium} Medium`,
    ].join('\n');

    const paths = input.executionPaths.length > 0
        ? `\n\n**Execution Paths:**\n${input.executionPaths.map(p => `- ${p}`).join('\n')}`
        : '';

    const confidence = input.confidence
        ? `\n\n**Confidence:**\n${input.confidence.score}% ${input.confidence.level}`
        : '';

    const rootCause = input.rootCause
        ? `\n\n**Root Cause:**\n${input.rootCause.name}\n\n**Supporting Findings:**\n${input.rootCause.supporting.map(s => `- ${s}`).join('\n')}`
        : '';

    const provenance = input.provenanceEvidence && input.provenanceEvidence.length > 0
        ? `\n\n**Workflow Provenance:**\n${input.provenanceEvidence.map(e => `- ${e}`).join('\n')}`
        : '';

    const mcp = input.mcpRisk
        ? `\n\n**MCP Risk Score:**\n${input.mcpRisk.score} (${input.mcpRisk.severity})`
            + `${input.mcpRisk.approvalMode ? `\n\n**Approval Mode:**\n${input.mcpRisk.approvalMode}` : ''}`
            + `\n\n**Capabilities:**\n${input.mcpRisk.capabilities.map(c => `- ${c}`).join('\n')}`
        : '';

    const diffs = input.workflowDiffs.length > 0
        ? `\n\n**Workflow Diff:**\n${input.workflowDiffs.map(entry => {
            const status = entry.introduced ? 'New Privileged Execution Path Introduced'
                : entry.removed ? 'Execution Path Removed'
                    : 'No privileged path change detected';
            const rr = typeof entry.riskReduction === 'number' ? ` (Risk Reduction: ${entry.riskReduction}%)` : '';
            const before = entry.before ? `Before:\n${entry.before}\n` : '';
            const after = entry.after ? `After:\n${entry.after}\n` : '';
            return `\n**${entry.filePath}**\n${status}${rr}\n\n${before}${after}`.trimEnd();
        }).join('\n\n')}`
        : '';

    return `${header}${files}${findings}${paths}${confidence}${rootCause}${provenance}${mcp}${diffs}\n`;
}

export function computeRootCauseSummary(findings: Finding[]): { name: string; supporting: string[] } | undefined {
    const analysis = analyzeRootCause(findings);
    if (!analysis) return undefined;
    return {
        name: analysis.rootCause.rule_id,
        supporting: analysis.supportingFindings.map(f => f.rule_id),
    };
}

export function summarizeWorkflowPath(workflow: { path: any } | undefined): string | undefined {
    if (!workflow) return undefined;
    return workflowPathSummary(workflow as any);
}
