"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkStructure = checkStructure;
function checkStructure(input) {
    const findings = [];
    const lowerText = input.text.toLowerCase();
    const asksForData = ["format", "schema", "output", "generate a", "return", "provide"];
    const formatEnforcers = ["json", "yaml", "xml", "markdown", "csv", "```"];
    const expectsData = asksForData.some(w => lowerText.includes(w));
    const enforcedFormat = formatEnforcers.some(w => lowerText.includes(w));
    if (expectsData && !enforcedFormat) {
        findings.push({
            rule_id: "struct_missing_format_enforcer",
            category: "structure",
            severity: "medium",
            explanation: "Output formatting requested but no strong format enforcer (JSON, YAML, Markdown syntax) is present.",
            suggested_fix: "Explicitly mention a data format (e.g., 'JSON') or use markdown blocks to specify structured output constraints.",
            penalty_score: 15
        });
    }
    return findings;
}
