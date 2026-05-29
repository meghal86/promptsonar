import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeRootCause, evaluatePrompt, formatToSarif } from '../src';
import type { Finding } from '../src';

const fixturesDir = path.resolve(__dirname, '../test/fixtures/workflows');

function readFixture(name: string): string {
    return fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
}

function scan(name: string) {
    const filePath = path.join(fixturesDir, name);
    return evaluatePrompt({ text: readFixture(name), context: { filePath } });
}

function firstWorkflowFinding(findings: Finding[]): Finding | undefined {
    return findings.find((f) => f.workflow?.path?.nodes?.length);
}

describe('Workflow Provenance Engine v1', () => {
    it('attaches deterministic evidence to every inferred workflow path', () => {
        const result = scan('mcp-auto-execute.prompt');
        const finding = firstWorkflowFinding(result.findings);

        expect(finding?.workflow?.evidence?.length).toBeGreaterThan(0);
        expect(finding?.workflow?.workflow_evidence?.length).toBeGreaterThan(0);

        // Every evidence item must trace back to a real finding (no invented data).
        for (const ev of finding!.workflow!.evidence!) {
            expect(ev.ruleId).toBe(finding!.rule_id);
            expect(typeof ev.source).toBe('string');
            expect(ev.source.length).toBeGreaterThan(0);
            expect(ev.label.length).toBeGreaterThan(0);
        }

        // autoExecute=true is literally present in the fixture, so it must appear.
        expect(finding!.workflow!.workflow_evidence).toContain('autoExecute=true');
    });

    it('generates a deterministic confidence score and level', () => {
        const result = scan('mcp-auto-execute.prompt');
        const finding = firstWorkflowFinding(result.findings);
        const wf = finding!.workflow!;

        expect(typeof wf.confidence_score).toBe('number');
        expect(wf.confidence_score!).toBeGreaterThanOrEqual(0);
        expect(wf.confidence_score!).toBeLessThanOrEqual(100);
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(wf.confidence_level);

        // Level must match the fixed thresholds (0-49 LOW, 50-79 MEDIUM, 80-100 HIGH).
        const s = wf.confidence_score!;
        const expected = s >= 80 ? 'HIGH' : s >= 50 ? 'MEDIUM' : 'LOW';
        expect(wf.confidence_level).toBe(expected);
    });

    it('is deterministic — identical input yields identical score', () => {
        const a = firstWorkflowFinding(scan('mcp-auto-execute.prompt').findings);
        const b = firstWorkflowFinding(scan('mcp-auto-execute.prompt').findings);
        expect(a!.workflow!.confidence_score).toBe(b!.workflow!.confidence_score);
        expect(a!.workflow!.workflow_evidence).toEqual(b!.workflow!.workflow_evidence);
    });

    it('produces per-node provenance with confidence contributions and rule matches', () => {
        const result = scan('autonomous-shell-execution.prompt');
        const finding = firstWorkflowFinding(result.findings);
        const nodesWithProvenance = finding!.workflow!.path.nodes.filter((n) => n.provenance);

        expect(nodesWithProvenance.length).toBeGreaterThan(0);
        const node = nodesWithProvenance[0];
        expect(node.provenance!.confidenceContribution).toBeGreaterThan(0);
        expect(node.provenance!.ruleMatches.length).toBeGreaterThan(0);
        expect(node.provenance!.evidence.length).toBeGreaterThan(0);

        // Per-node contributions must not exceed the total path confidence.
        const sum = finding!.workflow!.path.nodes.reduce(
            (acc, n) => acc + (n.provenance?.confidenceContribution || 0),
            0,
        );
        expect(sum).toBeLessThanOrEqual(finding!.workflow!.confidence_score! + 0.0001);
    });

    it('groups findings under a single root cause without dropping any', () => {
        const result = scan('autonomous-shell-execution.prompt');
        const analysis = analyzeRootCause(result.findings);
        const securityCount = result.findings.filter((f) => f.category === 'security').length;

        expect(analysis).toBeDefined();
        expect(analysis!.rootCause.category).toBe('security');
        // root + supporting must equal the full set of security findings (no loss).
        expect(1 + analysis!.supportingFindings.length).toBe(securityCount);
        expect(analysis!.supportingFindings).not.toContain(analysis!.rootCause);
    });

    it('prefers MCP tool poisoning as the root cause when present', () => {
        const result = scan('mcp-auto-execute.prompt');
        const analysis = analyzeRootCause(result.findings);
        const hasMcp = result.findings.some((f) => f.rule_id === 'sec_mcp_tool_poisoning');
        if (hasMcp) {
            expect(analysis!.rootCause.rule_id).toBe('sec_mcp_tool_poisoning');
        }
    });

    it('returns undefined root cause when there are no security findings', () => {
        const result = evaluatePrompt({
            text: 'Summarize the following article in three concise bullet points.',
            context: { filePath: 'benign.prompt' },
        });
        expect(analyzeRootCause(result.findings)).toBeUndefined();
    });

    it('emits provenance metadata into SARIF results (backward compatible)', () => {
        const result = scan('autonomous-shell-execution.prompt');
        const finding = firstWorkflowFinding(result.findings);
        const sarif = JSON.parse(formatToSarif([finding as any], 'autonomous-shell-execution.prompt'));
        const props = sarif.runs[0].results[0].properties;

        expect(typeof props.confidence_score).toBe('number');
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(props.confidence_level);
        expect(Array.isArray(props.workflow_evidence)).toBe(true);
        expect(props.workflow_evidence.length).toBeGreaterThan(0);
        expect(typeof props.root_cause).toBe('string');
        expect(Array.isArray(props.supporting_findings)).toBe(true);

        // Existing SARIF structure must remain intact.
        expect(props.workflow).toBeDefined();
        expect(props.owasp === undefined || typeof props.owasp === 'string').toBe(true);
    });
});
