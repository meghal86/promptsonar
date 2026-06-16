import { describe, it, expect } from 'vitest';
import { evaluatePrompt } from '../src/rules/index';

describe('Agent B: Quality Tester (Consistency)', () => {
    const config = { efficiency: { token_budget: 8192 } };

    it('should trigger Consistency penalty when opposing keywords (etailed/short) are used together', () => {
        const opposingInstructions = "Write a highly detailed explanation of quantum mechanics. Keep it very short.";
        const result = evaluatePrompt({ text: opposingInstructions, context: { filePath: 'test.txt' } }, config);

        const hasContradiction = result.findings.some(f => f.rule_id === 'consist_contradiction');
        expect(hasContradiction).toBe(true);
        expect(result.score).toBeLessThan(100);
    });

    it('should PASS when no contradictory keywords exist', () => {
        const clearInstructions = "Write a highly detailed explanation of quantum mechanics. Take as much space as you need.";
        const result = evaluatePrompt({ text: clearInstructions, context: { filePath: 'test.txt' } }, config);

        const hasContradiction = result.findings.some(f => f.rule_id === 'cons_contradiction');
        expect(hasContradiction).toBe(false);
    });

    it('recommends observable verification for complex tasks', () => {
        const complexInstructions = "Analyze the supplied deployment plan, compare the operational risks across environments, identify unsafe assumptions, and return the recommended rollout decision.";
        const result = evaluatePrompt({ text: complexInstructions, context: { filePath: 'test.prompt' } }, config);
        const finding = result.findings.find(f => f.rule_id === 'bp_missing_cot');

        expect(finding?.suggested_fix).toContain('checklist');
        expect(finding?.suggested_fix).toContain('brief rationale');
        expect(finding?.suggested_fix).toContain('reviewed from the output');
    });
});
