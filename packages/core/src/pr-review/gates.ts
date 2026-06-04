import type { WorkflowDiff } from '../workflow/types';
import type { PromptSonarPrReviewConfig } from './config';
import type { Severity } from '../rules/types';

export interface PrReviewCounts {
    critical: number;
    high: number;
    medium: number;
}

export interface PrReviewWorkflowDiffSummary {
    filePath: string;
    diff?: WorkflowDiff;
    executionPathIntroduced: boolean;
}

export interface PrReviewGateInput {
    counts: PrReviewCounts;
    workflowDiffs: PrReviewWorkflowDiffSummary[];
    mcpRiskScore?: number;
}

export interface PrReviewGateDecision {
    shouldFail: boolean;
    reason?: string;
}

function severityLabel(severity: Severity): string {
    return severity.toUpperCase();
}

export function evaluatePrReviewGates(config: PromptSonarPrReviewConfig, input: PrReviewGateInput): PrReviewGateDecision {
    const failOn = new Set(config.fail_on);

    if (failOn.has('critical') && input.counts.critical > 0) {
        return { shouldFail: true, reason: `PromptSonar: ${input.counts.critical} ${severityLabel('critical' as Severity)} finding(s).` };
    }

    if (failOn.has('high') && input.counts.high > 0) {
        return { shouldFail: true, reason: `PromptSonar: ${input.counts.high} ${severityLabel('high' as Severity)} finding(s).` };
    }

    if (failOn.has('medium') && input.counts.medium > 0) {
        return { shouldFail: true, reason: `PromptSonar: ${input.counts.medium} ${severityLabel('medium' as Severity)} finding(s).` };
    }

    if (failOn.has('execution_path_introduced')) {
        const introduced = input.workflowDiffs.find(entry => entry.executionPathIntroduced);
        if (introduced) {
            return { shouldFail: true, reason: `PromptSonar: new privileged execution path introduced in ${introduced.filePath}.` };
        }
    }

    if (typeof config.mcp_risk_threshold === 'number' && typeof input.mcpRiskScore === 'number') {
        if (input.mcpRiskScore > config.mcp_risk_threshold) {
            return { shouldFail: true, reason: `PromptSonar: MCP risk score ${input.mcpRiskScore} > threshold ${config.mcp_risk_threshold}.` };
        }
    }

    return { shouldFail: false };
}

