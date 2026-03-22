"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateGovernancePolicy = evaluateGovernancePolicy;
/**
 * Evaluates scan results against a parsed Governance Policy.
 */
function evaluateGovernancePolicy(results, policy) {
    const violations = [];
    for (const result of results) {
        for (const rule of policy.policies) {
            // Path matching logic (simplified for prototype)
            let pathMatches = true;
            if (rule.match?.path) {
                const paths = Array.isArray(rule.match.path) ? rule.match.path : [rule.match.path];
                pathMatches = paths.some(p => {
                    const cleanPath = p.replace('*', '').replace('**', '');
                    return result.filePath.includes(cleanPath);
                });
            }
            if (!pathMatches)
                continue;
            const score = result.overall_score ?? result.score ?? 100;
            // Apply Thresholds
            if (rule.thresholds?.security_score_min && score < rule.thresholds.security_score_min) {
                violations.push(`Policy [${rule.id}]: File '${result.filePath}' score (${score}) is below minimum threshold (${rule.thresholds.security_score_min}).`);
            }
            // In a production environment, we would also verify `block_patterns` against the raw prompt text,
            // and `require` (e.g., json_mode) against the prompt structure/findings.
        }
    }
    return {
        passed: violations.length === 0,
        violations
    };
}
