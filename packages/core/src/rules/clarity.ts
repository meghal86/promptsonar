import { RuleInput, Finding } from './types';

export function checkClarity(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const lowerText = input.text.toLowerCase();

    // 1. Missing quantifiers
    const countKeywords = ["how many", "list", "array", "give me", "output"];
    const quantifiers = ["exactly", "top", "maximum", "at most", "at least", "limit to", "items"];

    const impliesCounting = countKeywords.some(keyword => lowerText.includes(keyword));
    const hasQuantifier = quantifiers.some(q => lowerText.includes(q));

    if (impliesCounting && !hasQuantifier) {
        findings.push({
            rule_id: "clarity_missing_quantifier",
            category: "clarity",
            severity: "medium",
            explanation: "Prompt asks for a list or amount but lacks explicit numerical limits (e.g. 'top 5', 'maximum 10').",
            suggested_fix: "Add an explicit quantifier like 'exactly 3' or 'maximum 5' to avoid unbounded outputs.",
            penalty_score: 10
        });
    }

    // 2. Open-ended tasks
    const openEndedPhrases = ["what do you think", "anything else", "tell me about", "can you write"];
    for (const phrase of openEndedPhrases) {
        if (lowerText.includes(phrase)) {
            findings.push({
                rule_id: "clarity_open_ended",
                category: "clarity",
                severity: "low",
                explanation: `Prompt contains open-ended phrasing '${phrase}' which can result in inconsistent LLM outputs.`,
                suggested_fix: "Be more direct and specific about the exact outcome required.",
                penalty_score: 5
            });
        }
    }

    // Include the original vague words check
    const VAGUE_WORDS = ["try", "maybe", "perhaps", "several", "some", "good"];
    for (const word of VAGUE_WORDS) {
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(lowerText)) {
            findings.push({
                rule_id: "clarity_vague_words",
                category: "clarity",
                severity: "low",
                explanation: `Prompt contains vague word '${word}'. Be more specific to improve LLM response quality.`,
                suggested_fix: `Remove or replace '${word}' with concrete instructions.`,
                penalty_score: 5
            });
        }
    }

    return findings;
}
