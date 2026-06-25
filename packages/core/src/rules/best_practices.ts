import { RuleInput, Finding } from './types';

function needsExamples(text: string): boolean {
    return /\b(classify|extract|transform|convert|generate|return|format|schema|json|yaml|csv|table|template)\b/i.test(text);
}

function needsDecisionCriteria(text: string): boolean {
    return /\b(autonomous|plan|planning|delegate|delegation|multi[-\s]?step|workflow|orchestrat|execute|deploy|release|rollout|compare|assess|evaluate|risk|decision|approve|approval)\b/i.test(text);
}

function needsBoundedRole(text: string): boolean {
    return /\b(assistant|agent|model|reviewer|operator|you are|act as|analyze|execute|deploy|review|scan|summarize|generate|classify|extract)\b/i.test(text);
}

export function checkBestPractices(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const lowerText = input.text.toLowerCase();

    // 1. Missing Persona
    const personaIndictators = ["you are a", "you are an expert", "act as", "role:", "persona:"];
    if (needsBoundedRole(input.text) && !personaIndictators.some(p => lowerText.includes(p))) {
        findings.push({
            rule_id: "bp_missing_persona",
            category: "best_practices",
            severity: "low",
            explanation: "Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.",
            suggested_fix: "Start the prompt with 'You are an expert...' or similar role-playing instructions.",
            evidenceKind: "absence",
            scopeLabel: "Instruction block",
            missingRequirement: "No bounded role or persona requirement was found within that block.",
            penalty_score: 5
        });
    }

    // 2. Missing Few-Shot Examples
    const exampleIndicators = ["example:", "for example", "input:", "output:"];
    if (needsExamples(input.text) && !exampleIndicators.some(p => lowerText.includes(p))) {
        findings.push({
            rule_id: "bp_missing_few_shot",
            category: "best_practices",
            severity: "low",
            explanation: "Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.",
            suggested_fix: "Add at least one 'Example:' block demonstrating the exact desired input-to-output mapping.",
            evidenceKind: "absence",
            scopeLabel: "Instruction block",
            missingRequirement: "No example input/output behavior was found within that block.",
            penalty_score: 5
        });
    }

    // 3. Missing observable reasoning contract
    const reasoningIndicators = ["brief rationale", "decision criteria", "checklist", "verify each", "first,", "second,"];
    if (needsDecisionCriteria(input.text) && input.text.length > 80 && !reasoningIndicators.some(p => lowerText.includes(p))) {
        findings.push({
            // Keep the rule id stable for report and suppression compatibility.
            rule_id: "bp_missing_cot",
            category: "best_practices",
            severity: "low",
            explanation: "Task appears complex but does not define observable decision criteria or verification steps.",
            suggested_fix: "Add a concise checklist, explicit decision criteria, or a brief rationale field that can be reviewed from the output.",
            evidenceKind: "absence",
            scopeLabel: "Instruction block",
            missingRequirement: "No verification requirement or reviewable decision criteria were found within that block.",
            penalty_score: 5
        });
    }

    return findings;
}
