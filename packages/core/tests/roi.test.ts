import { describe, it, expect } from 'vitest';
import { calculateROI } from '../dist/optimizer/costCalculator';

describe('Agent C: Hard ROI & Token Math Tester', () => {
    // Standard test rate
    const COST_PER_1K_TOKENS = 0.005;

    it('should accurately calculate savings per 10k calls for a 15k token prompt with 40% compression', () => {
        const originalTokens = 15000;
        const compressedTokens = 9000; // 40% reduction (6000 tokens saved)

        const result = calculateROI(originalTokens, compressedTokens);

        // Math: 6000 saved tokens = 6 * 1k blocks.
        // 6 * $0.005 = $0.03 saved per call.
        // $0.03 * 10,000 calls = $300.00 exactly.

        expect(result.originalTokens).toBe(15000);
        expect(result.newTokens).toBe(9000);
        expect(result.compressionRatio).toBe('60.0%');
        expect(result.dollarsSavedPer10kCalls).toBe(300.00);
    });

    it('should handle zero-token inputs gracefully without throwing NaN exceptions', () => {
        const originalTokens = 0;
        const compressedTokens = 0;

        const result = calculateROI(originalTokens, compressedTokens);

        expect(result.compressionRatio).toBe('0.0%');
        expect(result.dollarsSavedPer10kCalls).toBe(0.00);
    });

    it('should handle cases where compression fails entirely without crashing', () => {
        // e.g. the API times out and returns original tokens, or null representation
        // The costCalculator is a pure math function, it should handle edge bounds.
        const originalTokens = 1000;
        const compressedTokens = 1000;

        const result = calculateROI(originalTokens, compressedTokens);

        expect(result.compressionRatio).toBe('0.0%');
        expect(result.dollarsSavedPer10kCalls).toBe(0.00);
    });
});
