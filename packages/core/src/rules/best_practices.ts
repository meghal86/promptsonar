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
            penalty_score: 5
        });
    }

    // 3. Missing Chain-of-Thought (CoT)
    const cotIndicators = ["think step by step", "step-by-step", "explain your reasoning", "first,", "second,"];
    // Only flag CoT if the prompt looks complex (longer than 100 characters)
    if (input.text.length > 100 && !cotIndicators.some(p => lowerText.includes(p))) {
        findings.push({
            rule_id: "bp_missing_cot",
            category: "best_practices",
            severity: "low",
            explanation: "Task appears complex but lacks Chain-of-Thought prompting.",
            suggested_fix: "Add 'think step-by-step' to the end of the instructions to improve reasoning capabilities.",
            penalty_score: 5
        });
    }

    return findings;
}
