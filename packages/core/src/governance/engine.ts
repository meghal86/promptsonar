import { GovernancePolicy } from './schema';
import { ScanResultInput } from '../sbom/generator';
import { minimatch } from 'minimatch';

export interface GovernanceResult {
    passed: boolean;
    violations: string[];
}

/**
 * Evaluates scan results against a parsed Governance Policy.
 */
export function evaluateGovernancePolicy(results: ScanResultInput[], policy: GovernancePolicy): GovernanceResult {
    const violations: string[] = [];

    for (const result of results) {
        for (const rule of policy.policies) {
            // Path matching logic (simplified for prototype)
            let pathMatches = true;
            if (rule.match?.path) {
                const paths = Array.isArray(rule.match.path) ? rule.match.path : [rule.match.path];
                pathMatches = paths.some(p => {
                    return minimatch(result.filePath, p, { matchBase: true }) ||
                      minimatch(
                        result.filePath.replace(/\\/g, '/'), 
                        p.replace(/\\/g, '/'), 
                        { matchBase: true }
                      );
                });
            }

            if (!pathMatches) continue;

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
