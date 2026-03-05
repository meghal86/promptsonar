export type Severity = "low" | "medium" | "high" | "critical";
export interface Finding {
    rule_id: string;
    category: "clarity" | "security" | "efficiency" | "structure" | "consistency" | "best_practices" | "ethics";
    severity: Severity;
    explanation: string;
    suggested_fix?: string;
    penalty_score?: number;
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
