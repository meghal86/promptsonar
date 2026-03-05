"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUnboundedAccess = checkUnboundedAccess;
const PATTERNS = [
    /\ball\s+files\b/gi,
    /\bentire\s+database\b/gi,
    /\bevery\s+record\b/gi,
    /\bfull\s+access\b/gi,
    /\bunrestricted\s+access\b/gi,
    /\ball\s+records\b/gi,
    /\bthe\s+entire\s+(system|codebase|repo)\b/gi,
];
function checkUnboundedAccess(input) {
    const findings = [];
    const text = input.text;
    for (const pattern of PATTERNS) {
        // Reset lastIndex for global regexes before use
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
            findings.push({
                rule_id: "sec_unbounded_access",
                category: "security",
                severity: "high",
                explanation: "Unbounded access scope: no path or table restriction",
                suggested_fix: "Scope access: 'read from /safe/path only' or 'query table X only'",
                penalty_score: 15
            });
            break; // One finding is enough per prompt
        }
    }
    return findings;
}
