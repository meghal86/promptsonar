"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PromptSbomSchema = exports.DependencySchema = exports.ComponentSchema = exports.PropertySchema = void 0;
const zod_1 = require("zod");
// CycloneDX Component Property
exports.PropertySchema = zod_1.z.object({
    name: zod_1.z.string(),
    value: zod_1.z.string()
});
// CycloneDX Component (Specific to Prompts)
exports.ComponentSchema = zod_1.z.object({
    type: zod_1.z.literal('prompt'),
    name: zod_1.z.string(),
    version: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    properties: zod_1.z.array(exports.PropertySchema).optional(),
});
// CycloneDX Dependency Map
exports.DependencySchema = zod_1.z.object({
    ref: zod_1.z.string(),
    dependsOn: zod_1.z.array(zod_1.z.string()).optional()
});
// Full SBOM root matching PromptSonar FRD v0.2
exports.PromptSbomSchema = zod_1.z.object({
    $schema: zod_1.z.string(),
    bomFormat: zod_1.z.literal('CycloneDX'),
    specVersion: zod_1.z.literal('1.4'),
    serialNumber: zod_1.z.string().optional(),
    version: zod_1.z.number().int().optional(),
    components: zod_1.z.array(exports.ComponentSchema),
    dependencies: zod_1.z.array(exports.DependencySchema).optional()
});
