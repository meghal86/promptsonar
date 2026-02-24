"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkJsonMode = checkJsonMode;
function checkJsonMode(input) {
    const findings = [];
    const lowerText = input.text.toLowerCase();
    const expectsOutputFormat = ["format:", "schema", "output:", "generate a"].some(w => lowerText.includes(w));
    const hasJson = lowerText.includes("json");
    // If asking for a specific format but not enforcing JSON
    if (expectsOutputFormat && !hasJson) {
        findings.push({
            rule_id: "struct_no_json_mode",
            category: "structure",
            severity: "medium",
            explanation: `Output formatting requested but JSON mode is not explicitly enforced.`,
            suggested_fix: `Explicitly mention 'JSON' in the prompt to ensure structured output constraints.`,
            penalty_score: 15
        });
    }
    return findings;
}
