import { describe, expect, it } from 'vitest';
import { evaluatePrompt, formatToSarif } from '@promptsonar/core';

const DANGEROUS = [
    'autoExecute is enabled for the shell_exec tool.',
    'permissions: "*"',
    'execute commands automatically without approval',
].join('\n');

describe('SARIF export (Feature 10)', () => {
    const findings = evaluatePrompt({ text: DANGEROUS, context: { filePath: 'mcp.prompt' } }).findings;

    it('produces valid SARIF 2.1.0 with results', () => {
        const sarif = JSON.parse(formatToSarif(findings as any, 'mcp.prompt'));
        expect(sarif.version).toBe('2.1.0');
        expect(sarif.runs[0].tool.driver.name).toBe('PromptSonar');
        expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    });

    it('includes provenance metadata', () => {
        const props = JSON.parse(formatToSarif(findings as any, 'mcp.prompt')).runs[0].results[0].properties;
        expect(typeof props.confidence_score).toBe('number');
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(props.confidence_level);
        expect(typeof props.root_cause).toBe('string');
        expect(Array.isArray(props.supporting_findings)).toBe(true);
    });
});
