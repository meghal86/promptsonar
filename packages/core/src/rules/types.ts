import type { FindingWorkflow } from '../workflow/types';

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
}

export interface RuleContext {
    filePath: string;
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
