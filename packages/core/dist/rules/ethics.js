"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEthics = checkEthics;
const L11_PATTERNS = [
    /why\s+(do|are|is)\s+\w+\s+(people|group|community)\s+(tend|likely|prone)/gi,
    /create\s+content\s+that\s+(targets?|focuses?\s+on)\s+\w+\s+(demographic|group)/gi,
];
const L12_PATTERNS = [
    /only\s+\d+\s+(spots?|seats?|copies?)\s+(left|remaining)/gi,
    /expires?\s+in\s+\d+\s+(minutes?|hours?)/gi,
    /create\s+(urgency|fear|anxiety|fomo)/gi,
    /psychological\s+(trick|tactic|pressure)/gi,
];
function checkEthics(input) {
    const findings = [];
    const text = input.text;
    // Check for bias indicators (L11)
    for (const pattern of L11_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
            findings.push({
                rule_id: "ethics_bias_indicator",
                category: "ethics", // New category as per FRD v5.0
                severity: "high",
                explanation: "Bias indicator detected: Prompt may generate biased or discriminatory responses.",
                suggested_fix: "Rewrite with neutral framing.",
                penalty_score: 15
            });
            break; // One L11 finding per prompt is enough
        }
    }
    // Check for manipulation patterns (L12)
    for (const pattern of L12_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
            findings.push({
                rule_id: "ethics_manipulation",
                category: "ethics", // New category
                severity: "high",
                explanation: "Manipulative patterns detected: Prompt requests generation of fake urgency or psychological pressure.",
                suggested_fix: "Remove manipulative language patterns.",
                penalty_score: 15
            });
            break; // One L12 finding per prompt is enough
        }
    }
    return findings;
}
