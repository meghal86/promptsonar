import { describe, expect, it } from 'vitest';
import { parsePromptSonarPrReviewConfig } from '../src/pr-review/config';

describe('PR review config parsing', () => {
    it('uses defaults for empty config', () => {
        expect(parsePromptSonarPrReviewConfig('')).toEqual({ fail_on: ['critical'], mcp_risk_threshold: undefined });
    });

    it('parses fail_on list and threshold', () => {
        const parsed = parsePromptSonarPrReviewConfig(`
fail_on:
  - critical
  - execution_path_introduced
mcp_risk_threshold: 75
`);
        expect(parsed.fail_on).toEqual(['critical', 'execution_path_introduced']);
        expect(parsed.mcp_risk_threshold).toBe(75);
    });

    it('ignores unknown fail_on entries', () => {
        const parsed = parsePromptSonarPrReviewConfig(`
fail_on:
  - critical
  - banana
`);
        expect(parsed.fail_on).toEqual(['critical']);
    });
});

