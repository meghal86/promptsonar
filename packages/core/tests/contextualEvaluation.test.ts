import { describe, expect, it } from 'vitest';
import {
    CONTEXTUAL_RELEASE_THRESHOLDS,
    parseContextualEvaluationScenariosJson,
    runContextualEvaluation,
} from '../src';
import { contextualVisibleScenarios } from './fixtures/contextualVisibleScenarios';

describe('contextual visible regression evaluator', () => {
    it('contains the visible scenarios 1 through 24', () => {
        expect(contextualVisibleScenarios).toHaveLength(24);
        expect(contextualVisibleScenarios.map(scenario => scenario.name.slice(0, 2))).toEqual(
            Array.from({ length: 24 }, (_, index) => String(index + 1).padStart(2, '0')),
        );
        expect(contextualVisibleScenarios.filter(scenario => scenario.category === 'over_suppression_trap')).toHaveLength(4);
    });

    it('reports perfect visible regression metrics for the current normalized verdict engine', () => {
        const report = runContextualEvaluation(contextualVisibleScenarios, {
            track: 'visible_regression',
        });

        expect(report.metrics).toEqual({
            total: 24,
            passed: 24,
            precision: 1,
            recall: 1,
            verdictAccuracy: 1,
            falsePositiveRate: 0,
            falseSuppressionRate: 0,
        });
        expect(report.failedScenarioIds).toEqual([]);
        expect(report.byCategory.map(category => category.category).sort()).toEqual([
            'expected_capability',
            'false_positive_control',
            'over_suppression_trap',
            'risky_configuration',
            'vulnerability',
        ]);
        for (const category of report.byCategory) {
            expect(category.passed).toBe(category.total);
            expect(category.verdictAccuracy).toBe(1);
        }
    });

    it('keeps over-suppression scenarios 21 through 24 from becoming expected capability', () => {
        const report = runContextualEvaluation(contextualVisibleScenarios.slice(20), {
            track: 'visible_regression',
        });

        expect(report.metrics.falseSuppressionRate).toBe(0);
        expect(report.results.map(result => result.decision?.verdict)).toEqual([
            'risky_configuration',
            'risky_configuration',
            'risky_configuration',
            'risky_configuration',
        ]);
    });

    it('defines release thresholds before blind evaluation', () => {
        expect(CONTEXTUAL_RELEASE_THRESHOLDS.visible_regression).toEqual({
            minimumScenarios: 24,
            precision: 1,
            recall: 1,
            verdictAccuracy: 1,
            falseSuppressionRate: 0,
        });
        expect(CONTEXTUAL_RELEASE_THRESHOLDS.blind.minimumScenarios).toBe(10);
        expect(CONTEXTUAL_RELEASE_THRESHOLDS.blind.precision).toBeGreaterThanOrEqual(0.85);
        expect(CONTEXTUAL_RELEASE_THRESHOLDS.blind.falseSuppressionRate).toBeLessThanOrEqual(0.1);
    });

    it('accepts externally supplied blind fixtures without exposing expected answers in results', () => {
        const externalJson = JSON.stringify(contextualVisibleScenarios.slice(10, 12));
        const externalScenarios = parseContextualEvaluationScenariosJson(externalJson);
        const report = runContextualEvaluation(externalScenarios, {
            track: 'blind',
            revealScenarioDetails: false,
        });

        expect(report.track).toBe('blind');
        expect(report.metrics.total).toBe(2);
        expect(report.failedScenarioIds).toEqual([]);
        expect(report.results).toEqual([
            { name: externalScenarios[0].name, category: undefined, passed: true },
            { name: externalScenarios[1].name, category: undefined, passed: true },
        ]);
        expect(JSON.stringify(report.results)).not.toContain('expectedVerdict');
        expect(JSON.stringify(report.results)).not.toContain('vulnerability');
    });

    it('rejects malformed external fixture payloads with typed errors', () => {
        expect(() => parseContextualEvaluationScenariosJson('{}')).toThrow('must be an array');
        expect(() => parseContextualEvaluationScenariosJson('[{"name":"bad","category":"vulnerability"}]')).toThrow('input is required');
    });
});
