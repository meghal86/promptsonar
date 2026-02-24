import { RuleInput, Finding } from '../types';

const INJECTION_PATTERNS = [
    "ignore previous",
    "forget rules",
    "DAN",
    "do anything now",
    "system prompt",
    "disregard"
];

export function checkOwaspPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const lowerText = input.text.toLowerCase();

    for (const pattern of INJECTION_PATTERNS) {
        if (lowerText.includes(pattern)) {
            findings.push({
                rule_id: "sec_owasp_llm01_injection",
                category: "security",
                severity: "critical",
                explanation: `Potential prompt injection vulnerability (OWASP LLM01) detected: '${pattern}'.`,
                suggested_fix: `Remove this pattern and rely on strict system boundaries or delimiters.`,
                penalty_score: 30
            });
        }
    }

    return findings;
}
