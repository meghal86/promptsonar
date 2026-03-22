import { z } from 'zod';

// CycloneDX Component Property
export const PropertySchema = z.object({
    name: z.string(),
    value: z.string()
});

// CycloneDX Component (Specific to Prompts)
export const ComponentSchema = z.object({
    type: z.literal('prompt'),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
    properties: z.array(PropertySchema).optional(),
});

// CycloneDX Dependency Map
export const DependencySchema = z.object({
    ref: z.string(),
    dependsOn: z.array(z.string()).optional()
});

// Full SBOM root matching PromptSonar FRD v0.2
export const PromptSbomSchema = z.object({
    $schema: z.string(),
    bomFormat: z.literal('CycloneDX'),
    specVersion: z.literal('1.4'),
    serialNumber: z.string().optional(),
    version: z.number().int().optional(),
    components: z.array(ComponentSchema),
    dependencies: z.array(DependencySchema).optional()
});

export type PromptSbom = z.infer<typeof PromptSbomSchema>;
export type PromptComponent = z.infer<typeof ComponentSchema>;
