"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRagInjection = checkRagInjection;
const TRIGGER_PATTERNS = [
    /search\s+for\s*:\s*\{[^}]*user[^}]*\}/gi,
    /\{user_input\}/gi,
    /\{user_query\}/gi,
    /\{raw_query\}/gi,
    /retrieve.*\{[^}]*user[^}]*\}/gi,
];
const NEGATIVE_INDICATORS = ['validated', 'sanitized', 'filtered', 'escaped'];
function checkRagInjection(input) {
    const findings = [];
    const text = input.text;
    const lowerText = text.toLowerCase();
    // Reset lastIndex for global regexes
    TRIGGER_PATTERNS.forEach(r => r.lastIndex = 0);
    for (const pattern of TRIGGER_PATTERNS) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            // Check context window of 100 chars (before and after the match) for negative indicators
            const startIdx = Math.max(0, match.index - 100);
            const endIdx = Math.min(text.length, match.index + match[0].length + 100);
            const contextStr = lowerText.substring(startIdx, endIdx);
            const hasNegativeIndicator = NEGATIVE_INDICATORS.some(ind => contextStr.includes(ind));
            if (!hasNegativeIndicator) {
                findings.push({
                    rule_id: "sec_rag_injection",
                    category: "security",
                    severity: "high",
                    explanation: "RAG injection risk: raw user input passed directly to retrieval query",
                    suggested_fix: "Validate and sanitize user input before retrieval. Use {validated_query} wrapper.",
                    penalty_score: 15
                });
                break; // One finding is sufficient per prompt
            }
        }
    }
    return findings;
}
