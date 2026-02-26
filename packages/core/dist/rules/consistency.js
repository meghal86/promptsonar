"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkConsistency = checkConsistency;
const CONTRADICTIONS = [
    { p1: "be concise", p2: "be detailed" },
    { p1: "short response", p2: "comprehensive explanation" },
    { p1: "only return", p2: "also include" },
    { p1: "simple language", p2: "highly technical" },
    { p1: "brief summary", p2: "exhaustive list" },
    { p1: "highly detailed", p2: "concise" },
    { p1: "etailed", p2: "short" },
    { p1: "detailed", p2: "short" }
];
function checkConsistency(input) {
    const findings = [];
    const lowerText = input.text.toLowerCase();
    for (const pair of CONTRADICTIONS) {
        if (lowerText.includes(pair.p1) && lowerText.includes(pair.p2)) {
            findings.push({
                rule_id: "consist_contradiction",
                category: "consistency",
                severity: "medium",
                explanation: `Contradicting instructions found: '${pair.p1}' and '${pair.p2}'.`,
                suggested_fix: `Remove one of the conflicting instructions to avoid LLM confusion.`,
                penalty_score: 10
            });
        }
    }
    return findings;
}
