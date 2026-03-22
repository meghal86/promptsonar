"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GovernancePolicySchema = exports.PolicyRuleSchema = void 0;
const zod_1 = require("zod");
exports.PolicyRuleSchema = zod_1.z.object({
    id: zod_1.z.string(),
    match: zod_1.z.object({
        path: zod_1.z.union([zod_1.z.string(), zod_1.z.array(zod_1.z.string())]).optional(),
        tags: zod_1.z.array(zod_1.z.string()).optional()
    }).optional(),
    thresholds: zod_1.z.object({
        security_score_min: zod_1.z.number().optional()
    }).optional(),
    block_patterns: zod_1.z.array(zod_1.z.string()).optional(),
    require: zod_1.z.array(zod_1.z.string()).optional()
});
exports.GovernancePolicySchema = zod_1.z.object({
    policies: zod_1.z.array(exports.PolicyRuleSchema)
});
