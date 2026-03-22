import { z } from 'zod';
export declare const PolicyRuleSchema: z.ZodObject<{
    id: z.ZodString;
    match: z.ZodOptional<z.ZodObject<{
        path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    thresholds: z.ZodOptional<z.ZodObject<{
        security_score_min: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    block_patterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
    require: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const GovernancePolicySchema: z.ZodObject<{
    policies: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        match: z.ZodOptional<z.ZodObject<{
            path: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>>;
        thresholds: z.ZodOptional<z.ZodObject<{
            security_score_min: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        block_patterns: z.ZodOptional<z.ZodArray<z.ZodString>>;
        require: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;
