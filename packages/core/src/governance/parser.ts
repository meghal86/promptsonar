import * as fs from 'fs';
import * as yaml from 'yaml';
import { GovernancePolicySchema, GovernancePolicy } from './schema';

/**
 * Parses a .promptsonar-policy.yaml file and validates it against the DSL schema.
 */
export function parseGovernancePolicy(filePath: string): GovernancePolicy {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Policy file not found: ${filePath}`);
    }
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const parsedYaml = yaml.parse(fileContents);
    return GovernancePolicySchema.parse(parsedYaml);
}
