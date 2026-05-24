import { z } from 'zod';

export const PolicyRuleSchema = z.object({
    id: z.string(),
    match: z.object({
        path: z.union([z.string(), z.array(z.string())]).optional(),
        tags: z.array(z.string()).optional()
    }).optional(),
    thresholds: z.object({
        security_score_min: z.number().optional()
    }).optional(),
    block_patterns: z.array(z.string()).optional(),
    require: z.array(z.string()).optional()
});

export const GovernancePolicySchema = z.object({
    policies: z.array(PolicyRuleSchema)
});

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;
