import type { CanonicalAnalysisIssue, ContextualVerdict } from './types';

export interface ContextualSarifOptions {
    includeCapabilityInventory?: boolean;
    includeQualitySuggestions?: boolean;
}

export interface SarifValidationResult {
    valid: boolean;
    errors: string[];
}

export type ContextualSarifLevel = 'error' | 'warning' | 'note' | 'omit';

export function severityToSecuritySeverity(severity: string): string {
    if (severity === 'critical') return '9.0';
    if (severity === 'high') return '7.0';
    if (severity === 'medium') return '5.0';
    return '2.0';
}

export function severityToSarifRank(severity: string): number {
    if (severity === 'critical') return 90;
    if (severity === 'high') return 70;
    if (severity === 'medium') return 50;
    return 20;
}

export function contextualVerdictToSarifLevel(
    verdict: ContextualVerdict | undefined,
    severity: string,
    options: ContextualSarifOptions = {},
): ContextualSarifLevel {
    if (!verdict) {
        if (severity === 'critical' || severity === 'high') return 'error';
        if (severity === 'medium') return 'warning';
        return 'note';
    }
    if (verdict === 'expected_capability') return options.includeCapabilityInventory ? 'note' : 'omit';
    if (verdict === 'vulnerability') return 'error';
    if (verdict === 'risky_configuration') return severity === 'critical' || severity === 'high' ? 'error' : 'warning';
    if (verdict === 'capability_review') return 'warning';
    if (verdict === 'quality_suggestion') return options.includeQualitySuggestions ? 'note' : 'omit';
    return 'note';
}

export function shouldIncludeIssueInSarif(issue: Pick<CanonicalAnalysisIssue, 'severity' | 'context'>, options: ContextualSarifOptions = {}): boolean {
    return contextualVerdictToSarifLevel(issue.context?.verdict, String(issue.severity), options) !== 'omit';
}

export function validateSarifLogShape(value: unknown): SarifValidationResult {
    const errors: string[] = [];
    const log = value as any;
    if (!log || typeof log !== 'object') {
        return { valid: false, errors: ['SARIF log must be an object'] };
    }
    if (log.version !== '2.1.0') errors.push('SARIF version must be 2.1.0');
    if (typeof log.$schema !== 'string' || !log.$schema.includes('sarif')) errors.push('SARIF $schema must reference a SARIF schema');
    if (!Array.isArray(log.runs) || log.runs.length === 0) {
        errors.push('SARIF runs must contain at least one run');
    }
    for (const [runIndex, run] of (log.runs || []).entries()) {
        if (!run?.tool?.driver?.name) errors.push(`runs[${runIndex}].tool.driver.name is required`);
        if (!Array.isArray(run?.tool?.driver?.rules)) errors.push(`runs[${runIndex}].tool.driver.rules must be an array`);
        if (!Array.isArray(run?.results)) errors.push(`runs[${runIndex}].results must be an array`);
        for (const [resultIndex, result] of (run?.results || []).entries()) {
            if (!result.ruleId) errors.push(`runs[${runIndex}].results[${resultIndex}].ruleId is required`);
            if (!['error', 'warning', 'note', 'none'].includes(result.level)) errors.push(`runs[${runIndex}].results[${resultIndex}].level is invalid`);
            if (!result.message?.text) errors.push(`runs[${runIndex}].results[${resultIndex}].message.text is required`);
            if (!Array.isArray(result.locations)) errors.push(`runs[${runIndex}].results[${resultIndex}].locations must be an array`);
            if (typeof result.rank !== 'number') errors.push(`runs[${runIndex}].results[${resultIndex}].rank is required`);
            if (typeof result.properties?.['security-severity'] !== 'string') errors.push(`runs[${runIndex}].results[${resultIndex}].properties.security-severity is required`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
