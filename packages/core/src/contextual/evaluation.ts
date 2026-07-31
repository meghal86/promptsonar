import type { CapabilityType, ContextualVerdict, SecurityControl, VerdictDecision, VerdictInput } from './types';
import { evaluateContextualVerdict } from './verdict';

export type ContextualEvaluationTrack = 'development' | 'visible_regression' | 'blind';
export type ContextualScenarioCategory =
    | 'expected_capability'
    | 'risky_configuration'
    | 'vulnerability'
    | 'false_positive_control'
    | 'over_suppression_trap';

export interface ContextualEvaluationScenario {
    name: string;
    category: ContextualScenarioCategory;
    profile?: Record<string, string>;
    files?: string[];
    input: VerdictInput;
    expected: {
        capabilities?: CapabilityType[];
        controls?: SecurityControl[];
        verdict: ContextualVerdict;
        maxSeverity: 'low' | 'medium' | 'high' | 'critical';
        mustNotReport?: Array<'critical_vulnerability' | 'vulnerability' | 'expected_capability'>;
    };
    suppressionSensitive?: boolean;
}

export interface ContextualEvaluationOptions {
    track?: ContextualEvaluationTrack;
    revealScenarioDetails?: boolean;
}

export interface ContextualScenarioResult {
    name: string;
    category?: ContextualScenarioCategory;
    passed: boolean;
    decision?: VerdictDecision;
    expectedVerdict?: ContextualVerdict;
    maxSeverity?: 'low' | 'medium' | 'high' | 'critical';
    errors?: string[];
}

export interface ContextualEvaluationMetrics {
    total: number;
    passed: number;
    precision: number;
    recall: number;
    verdictAccuracy: number;
    falsePositiveRate: number;
    falseSuppressionRate: number;
}

export interface ContextualCategoryMetrics extends ContextualEvaluationMetrics {
    category: ContextualScenarioCategory;
}

export interface ContextualEvaluationReport {
    track: ContextualEvaluationTrack;
    metrics: ContextualEvaluationMetrics;
    byCategory: ContextualCategoryMetrics[];
    results: ContextualScenarioResult[];
    failedScenarioIds: string[];
    releaseThresholds: typeof CONTEXTUAL_RELEASE_THRESHOLDS;
}

export const CONTEXTUAL_RELEASE_THRESHOLDS = {
    visible_regression: {
        minimumScenarios: 24,
        precision: 1,
        recall: 1,
        verdictAccuracy: 1,
        falseSuppressionRate: 0,
    },
    blind: {
        minimumScenarios: 10,
        precision: 0.85,
        recall: 0.85,
        verdictAccuracy: 0.8,
        falseSuppressionRate: 0.1,
    },
    toleratedUnsupportedCategories: [
        'dynamic runtime-only authorization',
        'framework-specific wiring not represented in normalized VerdictInput',
        'ambiguous fixture ground truth',
    ],
} as const;

const SEVERITY_RANK = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
} as const;

function isPositiveVerdict(verdict: ContextualVerdict): boolean {
    return verdict === 'vulnerability' || verdict === 'risky_configuration';
}

function severityWithin(decision: VerdictDecision, maxSeverity: keyof typeof SEVERITY_RANK): boolean {
    return SEVERITY_RANK[decision.severityCeiling] <= SEVERITY_RANK[maxSeverity];
}

function violatesMustNotReport(decision: VerdictDecision, mustNotReport: ContextualEvaluationScenario['expected']['mustNotReport'] = []): boolean {
    return mustNotReport.some(item => {
        if (item === 'critical_vulnerability') return decision.verdict === 'vulnerability' && decision.severityCeiling === 'critical';
        if (item === 'vulnerability') return decision.verdict === 'vulnerability';
        if (item === 'expected_capability') return decision.verdict === 'expected_capability';
        return false;
    });
}

function roundMetric(value: number): number {
    return Number(value.toFixed(4));
}

function computeMetrics(results: Array<{ scenario: ContextualEvaluationScenario; decision: VerdictDecision; passed: boolean }>): ContextualEvaluationMetrics {
    const total = results.length;
    const passed = results.filter(result => result.passed).length;
    const truePositive = results.filter(result =>
        isPositiveVerdict(result.scenario.expected.verdict) && isPositiveVerdict(result.decision.verdict)
    ).length;
    const falsePositive = results.filter(result =>
        !isPositiveVerdict(result.scenario.expected.verdict) && isPositiveVerdict(result.decision.verdict)
    ).length;
    const falseNegative = results.filter(result =>
        isPositiveVerdict(result.scenario.expected.verdict) && !isPositiveVerdict(result.decision.verdict)
    ).length;
    const expectedNegative = results.filter(result => !isPositiveVerdict(result.scenario.expected.verdict)).length;
    const exactVerdict = results.filter(result => result.decision.verdict === result.scenario.expected.verdict).length;
    const suppressionSensitive = results.filter(result => result.scenario.suppressionSensitive);
    const falseSuppressed = suppressionSensitive.filter(result => result.decision.verdict !== result.scenario.expected.verdict).length;

    return {
        total,
        passed,
        precision: roundMetric(truePositive + falsePositive === 0 ? 1 : truePositive / (truePositive + falsePositive)),
        recall: roundMetric(truePositive + falseNegative === 0 ? 1 : truePositive / (truePositive + falseNegative)),
        verdictAccuracy: roundMetric(total === 0 ? 1 : exactVerdict / total),
        falsePositiveRate: roundMetric(expectedNegative === 0 ? 0 : falsePositive / expectedNegative),
        falseSuppressionRate: roundMetric(suppressionSensitive.length === 0 ? 0 : falseSuppressed / suppressionSensitive.length),
    };
}

function evaluateScenario(scenario: ContextualEvaluationScenario): { scenario: ContextualEvaluationScenario; decision: VerdictDecision; passed: boolean; errors: string[] } {
    const decision = evaluateContextualVerdict(scenario.input);
    const errors: string[] = [];
    if (decision.verdict !== scenario.expected.verdict) {
        errors.push(`expected verdict ${scenario.expected.verdict}, got ${decision.verdict}`);
    }
    if (!severityWithin(decision, scenario.expected.maxSeverity)) {
        errors.push(`severity ceiling ${decision.severityCeiling} exceeds ${scenario.expected.maxSeverity}`);
    }
    if (violatesMustNotReport(decision, scenario.expected.mustNotReport)) {
        errors.push(`decision violates mustNotReport ${scenario.expected.mustNotReport?.join(', ')}`);
    }
    return {
        scenario,
        decision,
        passed: errors.length === 0,
        errors,
    };
}

export function runContextualEvaluation(
    scenarios: ContextualEvaluationScenario[],
    options: ContextualEvaluationOptions = {},
): ContextualEvaluationReport {
    const track = options.track || 'development';
    const revealScenarioDetails = options.revealScenarioDetails ?? track !== 'blind';
    const evaluated = scenarios.map(evaluateScenario);
    const metrics = computeMetrics(evaluated);
    const categories = Array.from(new Set(scenarios.map(scenario => scenario.category))).sort();
    const byCategory = categories.map(category => ({
        category,
        ...computeMetrics(evaluated.filter(result => result.scenario.category === category)),
    }));
    const detailedResults = evaluated.map(result => ({
        name: result.scenario.name,
        category: revealScenarioDetails ? result.scenario.category : undefined,
        passed: result.passed,
        decision: revealScenarioDetails ? result.decision : undefined,
        expectedVerdict: revealScenarioDetails ? result.scenario.expected.verdict : undefined,
        maxSeverity: revealScenarioDetails ? result.scenario.expected.maxSeverity : undefined,
        errors: revealScenarioDetails ? result.errors : undefined,
    }));

    return {
        track,
        metrics,
        byCategory,
        results: detailedResults,
        failedScenarioIds: evaluated.filter(result => !result.passed).map(result => result.scenario.name),
        releaseThresholds: CONTEXTUAL_RELEASE_THRESHOLDS,
    };
}

function assertScenarioShape(value: any, index: number): asserts value is ContextualEvaluationScenario {
    if (!value || typeof value !== 'object') throw new Error(`scenario[${index}] must be an object`);
    if (typeof value.name !== 'string' || value.name.length === 0) throw new Error(`scenario[${index}].name is required`);
    if (typeof value.category !== 'string') throw new Error(`scenario[${index}].category is required`);
    if (!value.input || typeof value.input !== 'object') throw new Error(`scenario[${index}].input is required`);
    if (!value.expected || typeof value.expected !== 'object') throw new Error(`scenario[${index}].expected is required`);
    if (typeof value.expected.verdict !== 'string') throw new Error(`scenario[${index}].expected.verdict is required`);
    if (typeof value.expected.maxSeverity !== 'string') throw new Error(`scenario[${index}].expected.maxSeverity is required`);
}

export function parseContextualEvaluationScenariosJson(json: string): ContextualEvaluationScenario[] {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('contextual evaluation fixture must be an array');
    parsed.forEach(assertScenarioShape);
    return parsed;
}
