import { RuleInput, Finding } from './types';

export function checkBestPractices(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const lowerText = input.text.toLowerCase();

    // 1. Missing Persona
    const personaIndictators = ["you are a", "you are an expert", "act as", "role:", "persona:"];
    if (!personaIndictators.some(p => lowerText.includes(p))) {
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
    if (!exampleIndicators.some(p => lowerText.includes(p))) {
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
    if (input.text.length > 100 && !reasoningIndicators.some(p => lowerText.includes(p))) {
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
