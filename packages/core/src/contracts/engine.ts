import * as YAML from 'yaml';
import { z } from 'zod';

// Zod schema to validate the structure of the prompt contract itself
export const PromptContractSchema = z.object({
  contract: z.object({
    id: z.string(),
    input: z.object({
      properties: z.record(z.string(), z.object({
        type: z.enum(['string', 'number', 'boolean'])
      })),
      required: z.array(z.string()).optional()
    }).optional(),
    output: z.object({
      properties: z.record(z.string(), z.object({
        type: z.enum(['string', 'number', 'boolean'])
      })),
      required: z.array(z.string()).optional()
    }).optional(),
    safety: z.object({
      must_not: z.array(z.string()).optional(),
      must_have: z.array(z.string()).optional()
    }).optional()
  })
});

const PromptRulesSchema = z.object({
  rules: z.array(z.object({
    name: z.string(),
    type: z.string(),
    format: z.string().optional(),
    style: z.string().optional(),
    max_tokens: z.number().optional(),
    phrases: z.array(z.string()).optional()
  }))
});

export interface ContractProperty {
  type: 'string' | 'number' | 'boolean';
}

export interface PromptContract {
  contract: {
    id: string;
    input?: {
      properties: Record<string, ContractProperty>;
      required?: string[];
    };
    output?: {
      properties: Record<string, ContractProperty>;
      required?: string[];
    };
    safety?: {
      must_not?: string[];
      must_have?: string[];
    };
  };
}

export interface ContractValidationResult {
  passed: boolean;
  violations: string[];
  contractId: string;
}

interface PromptRule {
  name: string;
  type: string;
  phrases?: string[];
}

/**
 * Parses and validates a contract YAML string.
 */
export function parsePromptContract(yamlContent: string): PromptContract {
  const parsed = YAML.parse(yamlContent);
  const validated = PromptContractSchema.parse(parsed) as unknown as PromptContract;
  return validated;
}

/**
 * Validates prompt text and dynamic input variables against a prompt contract.
 */
export function validatePromptAgainstContract(
  promptText: string,
  contractYaml: string,
  variables: Record<string, any> = {}
): ContractValidationResult {
  const violations: string[] = [];
  let contractId = 'unknown';

  try {
    const parsedYaml = YAML.parse(contractYaml);

    if (parsedYaml?.rules) {
      const promptRules = PromptRulesSchema.parse(parsedYaml);
      for (const rule of promptRules.rules as PromptRule[]) {
        if (rule.type === 'deny_phrase') {
          for (const phrase of rule.phrases || []) {
            const regex = new RegExp(`\\b${phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
            if (regex.test(promptText)) {
              violations.push(`Rule "${rule.name}" failed: prompt contains blocked phrase "${phrase}".`);
            }
          }
        }
      }

      return {
        passed: violations.length === 0,
        violations,
        contractId: 'prompt-rules'
      };
    }

    const contractObj = PromptContractSchema.parse(parsedYaml) as unknown as PromptContract;
    const contract = contractObj.contract;
    contractId = contract.id;

    // 1. Safety Checks (must_not / must_have)
    if (contract.safety) {
      const { must_not, must_have } = contract.safety;

      if (must_not) {
        for (const phrase of must_not) {
          const regex = new RegExp(`\\b${phrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
          if (regex.test(promptText)) {
            violations.push(`Safety Violation: Prompt contains forbidden phrase/keyword "${phrase}".`);
          }
        }
      }

      if (must_have) {
        for (const phrase of must_have) {
          if (!promptText.toLowerCase().includes(phrase.toLowerCase())) {
            violations.push(`Safety Violation: Prompt is missing mandatory phrase/keyword "${phrase}".`);
          }
        }
      }
    }

    // 2. Template dynamic variables presence checks
    if (contract.input && contract.input.required) {
      for (const reqVar of contract.input.required) {
        const hasCurly1 = new RegExp(`\\{\\{\\s*${reqVar}\\s*\\}\\}`, 'i').test(promptText);
        const hasCurly2 = new RegExp(`\\{\\s*${reqVar}\\s*\\}`, 'i').test(promptText);
        if (!hasCurly1 && !hasCurly2) {
          violations.push(`Template Violation: Required variable "${reqVar}" is not referenced in the prompt template.`);
        }
      }
    }

    // 3. Variable values type and presence checks
    if (contract.input) {
      const { properties, required } = contract.input;

      if (required) {
        for (const reqVar of required) {
          if (variables[reqVar] === undefined || variables[reqVar] === null) {
            violations.push(`Value Violation: Missing required input variable value for "${reqVar}".`);
          }
        }
      }

      for (const [key, val] of Object.entries(variables)) {
        const spec = properties[key];
        if (spec) {
          const type = typeof val;
          if (spec.type === 'number') {
            if (type !== 'number' || isNaN(val)) {
              violations.push(`Value Type Violation: Variable "${key}" must be a number, but got "${type}".`);
            }
          } else if (spec.type === 'boolean') {
            if (type !== 'boolean') {
              violations.push(`Value Type Violation: Variable "${key}" must be a boolean, but got "${type}".`);
            }
          } else if (spec.type === 'string') {
            if (type !== 'string') {
              violations.push(`Value Type Violation: Variable "${key}" must be a string, but got "${type}".`);
            }
          }
        }
      }
    }

  } catch (err: any) {
    violations.push(`Prompt Rules Parsing Error: ${err.message}`);
  }

  return {
    passed: violations.length === 0,
    violations,
    contractId
  };
}
