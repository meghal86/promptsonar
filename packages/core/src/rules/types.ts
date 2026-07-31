import type { FindingWorkflow } from '../workflow/types';
import type { ArtifactKind, ExecutionIntent } from '../artifacts';

export type Severity = "low" | "medium" | "high" | "critical";
export type FindingEvidenceKind = "direct" | "absence";

export interface Finding {
    rule_id: string;
    category: "clarity" | "security" | "efficiency" | "structure" | "consistency" | "best_practices" | "ethics";
    severity: Severity;
    explanation: string;
    suggested_fix?: string;
    workflow?: FindingWorkflow;
    penalty_score?: number; // Internal score deduction
    matchedText?: string;
    evidenceKind?: FindingEvidenceKind;
    scopeLabel?: string;
    missingRequirement?: string;
    // Root-cause grouping (from codex/mcp-audit-launch-evidence): a primary
    // finding carries its root_cause + the explanations of supporting findings,
    // and each grouped supporting finding is flagged is_supporting.
    root_cause?: string;
    supporting_findings?: string[];
    is_supporting?: boolean;
}

export interface RuleContext {
    filePath: string;
    artifactKind?: ArtifactKind;
    executionIntent?: ExecutionIntent;
    sourceType?: string;
    hasExplicitPromptBlock?: boolean;
}

export interface RuleInput {
    text: string;
    language?: string;
    context: RuleContext;
}

export type RuleFunction = (input: RuleInput) => Finding[];

export interface RuleResult {
    score: number;
    status: "pass" | "warn" | "fail";
    findings: Finding[];
}
