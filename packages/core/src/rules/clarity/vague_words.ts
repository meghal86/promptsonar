import { RuleInput, Finding } from '../types';

const VAGUE_WORDS = ["try", "perhaps", "maybe", "several", "some", "good"];

export function checkVagueWords(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const lowerText = input.text.toLowerCase();

    for (const word of VAGUE_WORDS) {
        // using regex boundary to match exact words
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
