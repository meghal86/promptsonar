import { GovernancePolicy } from './schema';
import { ScanResultInput } from '../sbom/generator';
export interface GovernanceResult {
    passed: boolean;
    violations: string[];
}
/**
 * Evaluates scan results against a parsed Governance Policy.
 */
export declare function evaluateGovernancePolicy(results: ScanResultInput[], policy: GovernancePolicy): GovernanceResult;
