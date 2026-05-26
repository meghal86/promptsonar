import { z } from 'zod';
import * as fs from 'fs';
import * as YAML from 'yaml';

// ── Zod Schema ──────────────────────────────────────────────

const WaiverScopeSchema = z.object({
    rule_id: z.string().optional(),
    rule: z.string().optional(),
    path: z.string().optional(),
    prompt_id: z.string().optional(),
}).refine(
    (data) => {
        const set = [data.rule_id, data.rule, data.path, data.prompt_id].filter(Boolean);
        return set.length >= 1;
    },
    { message: 'Scope must include at least one of: rule_id, rule, path, or prompt_id' }
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
    waivers: z.array(WaiverSchema).optional().default([]),
    ignore: z.array(z.object({
        rule: z.string().optional(),
        rule_id: z.string().optional(),
        path: z.string().optional(),
        reason: z.string().optional(),
        expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expires_at must be YYYY-MM-DD format').optional(),
        expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expiry must be YYYY-MM-DD format').optional(),
    }).refine(
        (data) => Boolean(data.rule || data.rule_id || data.path),
        { message: 'Ignore entry must include rule, rule_id, or path' }
    )).optional().default([]),
});

// ── Types ───────────────────────────────────────────────────

export type Waiver = z.infer<typeof WaiverSchema>;
export type WaiverFile = z.infer<typeof WaiverFileSchema>;

export interface Suppression {
    ruleId?: string;
    path?: string;
    reason?: string;
    expiresAt?: string;
    source: string;
}

// ── Loader + Validator ──────────────────────────────────────

export interface WaiverLoadResult {
    waivers: Waiver[];
    suppressions: Suppression[];
    errors: string[];
}

/**
 * Load and validate waivers from a YAML file.
 * Expired and revoked waivers are loaded but not applied.
 */
export function loadWaivers(filePath: string): WaiverLoadResult {
    const errors: string[] = [];

    if (!fs.existsSync(filePath)) {
        return { waivers: [], suppressions: [], errors: [] }; // No waiver file is fine — not an error
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: any;

    try {
        parsed = YAML.parse(raw);
    } catch (err) {
        return { waivers: [], suppressions: [], errors: [`Failed to parse YAML: ${err}`] };
    }

    const result = WaiverFileSchema.safeParse(parsed);

    if (!result.success) {
        for (const issue of result.error.issues) {
            errors.push(`Waiver validation error at ${issue.path.join('.')}: ${issue.message}`);
        }
        return { waivers: [], suppressions: [], errors };
    }

    const suppressions = result.data.ignore.map((entry) => ({
        ruleId: normalizeRuleId(entry.rule_id || entry.rule),
        path: normalizePath(entry.path),
        reason: entry.reason,
        expiresAt: entry.expires_at || entry.expiry,
        source: filePath,
    }));

    return { waivers: result.data.waivers, suppressions, errors: [] };
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

export function getActiveSuppressions(suppressions: Suppression[]): Suppression[] {
    const now = new Date();

    return suppressions.filter((suppression) => {
        if (!suppression.expiresAt) return true;
        return new Date(suppression.expiresAt) >= now;
    });
}

export function normalizeRuleId(ruleId?: string): string | undefined {
    if (!ruleId) return undefined;
    const normalized = ruleId.trim();
    const upper = normalized.toUpperCase();
    const aliases: Record<string, string> = {
        C1: 'sec_owasp_llm01_injection',
        LLM01: 'sec_owasp_llm01_injection',
        UNICODE_ZERO_WIDTH: 'sec_zero_width_injection',
        ZERO_WIDTH: 'sec_zero_width_injection',
        E3: 'sec_zero_width_injection',
        HOMOGLYPH: 'sec_homoglyph_evasion',
        UNICODE_HOMOGLYPH: 'sec_homoglyph_evasion',
        E2: 'sec_homoglyph_evasion',
        BASE64: 'sec_base64_encoded_payload',
        E1: 'sec_base64_encoded_payload',
    };
    return aliases[upper] || normalized;
}

function normalizePath(filePath?: string): string | undefined {
    return filePath?.replace(/\\/g, '/');
}

function escapeRegex(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern: string): RegExp {
    const normalized = normalizePath(pattern) || '';
    let regex = '';

    for (let i = 0; i < normalized.length; i++) {
        const char = normalized[i];
        const next = normalized[i + 1];

        if (char === '*' && next === '*') {
            regex += '.*';
            i++;
        } else if (char === '*') {
            regex += '[^/]*';
        } else if (char === '?') {
            regex += '[^/]';
        } else {
            regex += escapeRegex(char);
        }
    }

    return new RegExp(`(^|/)${regex}$`);
}

function pathMatches(pattern: string, filePath: string): boolean {
    const normalizedFile = normalizePath(filePath) || filePath;
    const normalizedPattern = normalizePath(pattern) || pattern;

    if (normalizedFile === normalizedPattern || normalizedFile.endsWith(`/${normalizedPattern}`)) {
        return true;
    }

    return globToRegex(normalizedPattern).test(normalizedFile);
}

export function getWaiverSuppressions(activeWaivers: Waiver[]): Suppression[] {
    return activeWaivers.map((waiver) => ({
        ruleId: normalizeRuleId(waiver.scope.rule_id || waiver.scope.rule),
        path: normalizePath(waiver.scope.path),
        reason: waiver.justification,
        expiresAt: waiver.expires_at,
        source: waiver.id,
    }));
}

export function isFindingSuppressed(
    ruleId: string,
    filePath: string,
    activeSuppressions: Suppression[]
): Suppression | undefined {
    const normalizedRule = normalizeRuleId(ruleId);

    return activeSuppressions.find((suppression) => {
        const ruleMatches = !suppression.ruleId || suppression.ruleId === normalizedRule;
        const pathMatchesSuppression = !suppression.path || pathMatches(suppression.path, filePath);
        return ruleMatches && pathMatchesSuppression;
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
    return Boolean(isFindingSuppressed(ruleId, filePath, getWaiverSuppressions(activeWaivers)));
}
