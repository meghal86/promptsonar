import { z } from 'zod';
declare const WaiverSchema: z.ZodObject<{
    id: z.ZodString;
    status: z.ZodEnum<{
        active: "active";
        expired: "expired";
        revoked: "revoked";
    }>;
    scope: z.ZodObject<{
        rule_id: z.ZodOptional<z.ZodString>;
        path: z.ZodOptional<z.ZodString>;
        prompt_id: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    justification: z.ZodString;
    ticket_url: z.ZodOptional<z.ZodString>;
    expires_at: z.ZodString;
    owner: z.ZodOptional<z.ZodString>;
    approved_by: z.ZodOptional<z.ZodString>;
    created_by: z.ZodOptional<z.ZodString>;
    created_at: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
declare const WaiverFileSchema: z.ZodObject<{
    waivers: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        status: z.ZodEnum<{
            active: "active";
            expired: "expired";
            revoked: "revoked";
        }>;
        scope: z.ZodObject<{
            rule_id: z.ZodOptional<z.ZodString>;
            path: z.ZodOptional<z.ZodString>;
            prompt_id: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        justification: z.ZodString;
        ticket_url: z.ZodOptional<z.ZodString>;
        expires_at: z.ZodString;
        owner: z.ZodOptional<z.ZodString>;
        approved_by: z.ZodOptional<z.ZodString>;
        created_by: z.ZodOptional<z.ZodString>;
        created_at: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Waiver = z.infer<typeof WaiverSchema>;
export type WaiverFile = z.infer<typeof WaiverFileSchema>;
export interface WaiverLoadResult {
    waivers: Waiver[];
    errors: string[];
}
/**
 * Load and validate waivers from a YAML file.
 * Expired and revoked waivers are loaded but not applied.
 */
export declare function loadWaivers(filePath: string): WaiverLoadResult;
/**
 * Returns only the active, non-expired waivers.
 */
export declare function getActiveWaivers(waivers: Waiver[]): Waiver[];
/**
 * Check if a specific finding is waived by any active waiver.
 */
export declare function isFindingWaived(ruleId: string, filePath: string, activeWaivers: Waiver[]): boolean;
export {};
