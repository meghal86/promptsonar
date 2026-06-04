import YAML from 'yaml';

export type PrReviewFailOn =
    | 'critical'
    | 'high'
    | 'medium'
    | 'execution_path_introduced';

export interface PromptSonarPrReviewConfig {
    fail_on: PrReviewFailOn[];
    mcp_risk_threshold?: number;
}

const DEFAULT_CONFIG: PromptSonarPrReviewConfig = {
    fail_on: ['critical'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFailOn(value: unknown): PrReviewFailOn[] {
    const candidates = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
    const normalized = candidates
        .map(entry => String(entry).trim())
        .filter(Boolean)
        .map(entry => entry.toLowerCase());

    const allowed = new Set<PrReviewFailOn>(['critical', 'high', 'medium', 'execution_path_introduced']);
    const result: PrReviewFailOn[] = [];
    for (const entry of normalized) {
        if (allowed.has(entry as PrReviewFailOn)) result.push(entry as PrReviewFailOn);
    }
    return Array.from(new Set(result));
}

function normalizeRiskThreshold(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const parsed = typeof value === 'number' ? value : Number(String(value));
    if (!Number.isFinite(parsed)) return undefined;
    if (parsed < 0) return 0;
    if (parsed > 100) return 100;
    return Math.round(parsed);
}

export function parsePromptSonarPrReviewConfig(yamlText: string): PromptSonarPrReviewConfig {
    const trimmed = yamlText.trim();
    if (!trimmed) return { ...DEFAULT_CONFIG };

    let parsed: unknown;
    try {
        parsed = YAML.parse(trimmed);
    } catch {
        return { ...DEFAULT_CONFIG };
    }

    if (!isRecord(parsed)) return { ...DEFAULT_CONFIG };

    const fail_on = normalizeFailOn(parsed.fail_on);
    const mcp_risk_threshold = normalizeRiskThreshold(parsed.mcp_risk_threshold);

    return {
        fail_on: fail_on.length > 0 ? fail_on : DEFAULT_CONFIG.fail_on,
        mcp_risk_threshold,
    };
}

