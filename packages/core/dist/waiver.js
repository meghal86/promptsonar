"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadWaivers = loadWaivers;
exports.getActiveWaivers = getActiveWaivers;
exports.isFindingWaived = isFindingWaived;
const zod_1 = require("zod");
const fs = __importStar(require("fs"));
const YAML = __importStar(require("yaml"));
// ── Zod Schema ──────────────────────────────────────────────
const WaiverScopeSchema = zod_1.z.object({
    rule_id: zod_1.z.string().optional(),
    path: zod_1.z.string().optional(),
    prompt_id: zod_1.z.string().optional(),
}).refine((data) => {
    const set = [data.rule_id, data.path, data.prompt_id].filter(Boolean);
    return set.length === 1;
}, { message: 'Scope must have exactly ONE of: rule_id, path, or prompt_id' });
const WaiverSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^WVR-\d{4}-\d{3}$/, 'Waiver ID must match WVR-YYYY-NNN format'),
    status: zod_1.z.enum(['active', 'expired', 'revoked']),
    scope: WaiverScopeSchema,
    justification: zod_1.z.string().min(20, 'Justification must be at least 20 characters'),
    ticket_url: zod_1.z.string().url().optional(),
    expires_at: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be YYYY-MM-DD format'),
    owner: zod_1.z.string().optional(),
    approved_by: zod_1.z.string().optional(),
    created_by: zod_1.z.string().optional(),
    created_at: zod_1.z.string().optional(),
});
const WaiverFileSchema = zod_1.z.object({
    waivers: zod_1.z.array(WaiverSchema),
});
/**
 * Load and validate waivers from a YAML file.
 * Expired and revoked waivers are loaded but not applied.
 */
function loadWaivers(filePath) {
    const errors = [];
    if (!fs.existsSync(filePath)) {
        return { waivers: [], errors: [] }; // No waiver file is fine — not an error
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed;
    try {
        parsed = YAML.parse(raw);
    }
    catch (err) {
        return { waivers: [], errors: [`Failed to parse YAML: ${err}`] };
    }
    const result = WaiverFileSchema.safeParse(parsed);
    if (!result.success) {
        for (const issue of result.error.issues) {
            errors.push(`Waiver validation error at ${issue.path.join('.')}: ${issue.message}`);
        }
        return { waivers: [], errors };
    }
    return { waivers: result.data.waivers, errors: [] };
}
/**
 * Returns only the active, non-expired waivers.
 */
function getActiveWaivers(waivers) {
    const now = new Date();
    return waivers.filter(w => {
        if (w.status !== 'active')
            return false;
        // Check expiry
        const expiresAt = new Date(w.expires_at);
        if (expiresAt < now)
            return false;
        return true;
    });
}
/**
 * Check if a specific finding is waived by any active waiver.
 */
function isFindingWaived(ruleId, filePath, activeWaivers) {
    for (const waiver of activeWaivers) {
        const scope = waiver.scope;
        // Match by rule_id
        if (scope.rule_id && scope.rule_id === ruleId) {
            return true;
        }
        // Match by path (glob-like: if the waiver path ends with **, match prefix)
        if (scope.path) {
            const pattern = scope.path;
            if (pattern.endsWith('**')) {
                const prefix = pattern.slice(0, -2);
                if (filePath.includes(prefix))
                    return true;
            }
            else if (filePath.includes(pattern)) {
                return true;
            }
        }
        // prompt_id matching would require hash of prompt text — skipped for now
    }
    return false;
}
