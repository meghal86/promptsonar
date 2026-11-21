import { RuleInput, Finding } from '../types';

// An order to adopt a persona: at the start of a sentence, line or list item, or
// after "you"/"please"/"now". "Errors could act as common causes" describes,
// it does not instruct.
const TRIGGER_PATTERNS = [
    /(?<=^|[.!?:;\n]\s*|^\s*[-*]\s+|\b(?:please|now|you\s+(?:will|should|must|shall))\s+)(act\s+as|you\s+are\s+now|pretend\s+to\s+be|imagine\s+you\s+are)\b/gi
];

const CONSTRAINT_INDICATORS = [
    'only', 'never', 'limited to', 'must not', 'except', 'solely', 'exclusively'
];

export function checkUnboundedPersona(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    const text = input.text;
    const lowerText = text.toLowerCase();

    // Reset regex state since they are global
    TRIGGER_PATTERNS.forEach(r => r.lastIndex = 0);

    for (const pattern of TRIGGER_PATTERNS) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            // Found a trigger. Check the next 200 characters for constraint indicators.
            const nextContext = lowerText.substring(match.index, match.index + 200);
            const hasConstraint = CONSTRAINT_INDICATORS.some(indicator => nextContext.includes(indicator));

            if (!hasConstraint) {
                findings.push({
                    rule_id: "sec_unbounded_persona",
                    category: "security",
                    // A hardening hint: persona attacks (DAN, "unrestricted", "you are
                    // now an admin") are CRITICAL under sec_owasp_llm01_injection.
                    severity: "medium",
                    explanation: "Unbounded persona: 'act as' without behavioral constraints",
                    suggested_fix: "Add constraints: 'You are X but ONLY do Y. You NEVER do Z.'",
                    penalty_score: 15
                });
                break; // One finding per rule violation in the prompt is sufficient
            }
        }
    }

    return findings;
}
