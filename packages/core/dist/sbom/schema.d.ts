import { z } from 'zod';
export declare const PropertySchema: z.ZodObject<{
    name: z.ZodString;
    value: z.ZodString;
}, z.core.$strip>;
export declare const ComponentSchema: z.ZodObject<{
    type: z.ZodLiteral<"prompt">;
    name: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    properties: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const DependencySchema: z.ZodObject<{
    ref: z.ZodString;
    dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const PromptSbomSchema: z.ZodObject<{
    $schema: z.ZodString;
    bomFormat: z.ZodLiteral<"CycloneDX">;
    specVersion: z.ZodLiteral<"1.4">;
    serialNumber: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodNumber>;
    components: z.ZodArray<z.ZodObject<{
        type: z.ZodLiteral<"prompt">;
        name: z.ZodString;
        version: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        properties: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            value: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        dependsOn: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type PromptSbom = z.infer<typeof PromptSbomSchema>;
export type PromptComponent = z.infer<typeof ComponentSchema>;
