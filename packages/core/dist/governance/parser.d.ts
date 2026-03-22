import { GovernancePolicy } from './schema';
/**
 * Parses a .promptsonar-policy.yaml file and validates it against the DSL schema.
 */
export declare function parseGovernancePolicy(filePath: string): GovernancePolicy;
