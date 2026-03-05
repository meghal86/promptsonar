import { z } from 'zod';
import * as fs from 'fs';
import * as YAML from 'yaml';

// ── Zod Schema ──────────────────────────────────────────────

const WaiverScopeSchema = z.object({
    rule_id: z.string().optional(),
    path: z.string().optional(),
    prompt_id: z.string().optional(),
}).refine(
    (data) => {
        const set = [data.rule_id, data.path, data.prompt_id].filter(Boolean);
        return set.length === 1;
    },
    { message: 'Scope must have exactly ONE of: rule_id, path, or prompt_id' }
);

const WaiverSchema = z.object({
    id: z.string().regex(/^WVR-\d{4}-\d{3}$/, 'Waiver ID must match WVR-YYYY-NNN format'),
    status: z.enum(['active', 'expired', 'revoked']),
    scope: WaiverScopeSchema,
    justification: z.string().min(20, 'Justification must be at least 20 characters'),
    ticket_url: z.string().url().optional(),
    expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be YYYY-MM-DD format'),
    owner: z.string().optional(),
    approved_by: z.string().optional(),
    created_by: z.string().optional(),
    created_at: z.string().optional(),
});

const WaiverFileSchema = z.object({
    waivers: z.array(WaiverSchema),
});

// ── Types ───────────────────────────────────────────────────

export type Waiver = z.infer<typeof WaiverSchema>;
export type WaiverFile = z.infer<typeof WaiverFileSchema>;

// ── Loader + Validator ──────────────────────────────────────

export interface WaiverLoadResult {
    waivers: Waiver[];
    errors: string[];
}

/**
 * Load and validate waivers from a YAML file.
 * Expired and revoked waivers are loaded but not applied.
 */
export function loadWaivers(filePath: string): WaiverLoadResult {
    const errors: string[] = [];

    if (!fs.existsSync(filePath)) {
        return { waivers: [], errors: [] }; // No waiver file is fine — not an error
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: any;

    try {
        parsed = YAML.parse(raw);
    } catch (err) {
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
export function getActiveWaivers(waivers: Waiver[]): Waiver[] {
    const now = new Date();

    return waivers.filter(w => {
        if (w.status !== 'active') return false;

        // Check expiry
        const expiresAt = new Date(w.expires_at);
        if (expiresAt < now) return false;

        return true;
    });
}

/**
 * Check if a specific finding is waived by any active waiver.
 */
export function isFindingWaived(
    ruleId: string,
    filePath: string,
    activeWaivers: Waiver[]
): boolean {
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
                if (filePath.includes(prefix)) return true;
            } else if (filePath.includes(pattern)) {
                return true;
            }
        }

        // prompt_id matching would require hash of prompt text — skipped for now
    }

    return false;
}
