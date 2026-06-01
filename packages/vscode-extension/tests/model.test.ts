import { describe, expect, it } from 'vitest';
import {
    buildPanelRows,
    executionPathRows,
    confidenceRow,
    evidenceRows,
    rootCauseRow,
    mcpRows,
    executionPathText,
    reportText,
    pickWorstWorkflowFinding,
    humanRuleName,
} from '../src/shared/model';
import { evaluatePrompt, auditMcpConfig } from '@promptsonar/core';

const DANGEROUS = [
    'autoExecute is enabled for the shell_exec tool.',
    'permissions: "*"',
    'execute commands automatically without approval',
].join('\n');

function scan() {
    return evaluatePrompt({ text: DANGEROUS, context: { filePath: 'mcp.prompt' } }).findings;
}

describe('panel model (Features 3, 4, 5, 6)', () => {
    const findings = scan();
    const worst = pickWorstWorkflowFinding(findings);

    it('builds execution-path rows from the workflow (Feature 3)', () => {
        const rows = executionPathRows(worst?.workflow);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.description === 'privileged sink')).toBe(true);
    });

    it('builds a confidence row with score + level (Feature 5)', () => {
        const row = confidenceRow(worst?.workflow);
        expect(row?.description).toMatch(/\d+% (LOW|MEDIUM|HIGH)/);
    });

    it('builds evidence rows from the provenance engine (Feature 4)', () => {
        const rows = evidenceRows(worst?.workflow);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].label.startsWith('✓')).toBe(true);
    });

    it('builds a root-cause row with supporting findings (Feature 6)', () => {
        const row = rootCauseRow(findings);
        expect(row?.label).toBe('Root Cause');
        expect(typeof row?.description).toBe('string');
    });

    it('assembles the full panel tree', () => {
        const labels = buildPanelRows(findings).map((r) => r.label);
        expect(labels).toContain('Execution Path');
        expect(labels).toContain('Root Cause');
    });

    it('returns empty rows for a safe prompt', () => {
        const safe = evaluatePrompt({ text: 'Summarize this article in 3 bullets.', context: { filePath: 's.prompt' } }).findings;
        expect(buildPanelRows(safe).find((r) => r.label === 'Execution Path')).toBeUndefined();
    });
});

describe('MCP rows (Feature 11)', () => {
    it('summarizes capabilities, permissions, approval mode, risk, and findings', () => {
        const audit = auditMcpConfig('mcp.json', JSON.stringify({
            mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/'], autoApprove: ['read_file'] } },
        }));
        const rows = mcpRows(audit);
        expect(rows.length).toBeGreaterThan(0);
        expect(JSON.stringify(rows)).toContain('Approval Mode');
    });

    it('returns nothing when there is no audit', () => {
        expect(mcpRows(undefined)).toEqual([]);
    });
});

describe('copy/report text (Feature 10)', () => {
    const findings = scan();

    it('produces a copyable execution path', () => {
        expect(executionPathText(pickWorstWorkflowFinding(findings)?.workflow)).toContain('↓');
    });

    it('produces a full report', () => {
        const text = reportText(findings, undefined, 'mcp.prompt');
        expect(text).toContain('PromptSonar Report');
        expect(text).toContain('Execution Path');
        expect(text).toContain('Confidence');
    });

    it('humanRuleName maps known + unknown ids', () => {
        expect(humanRuleName('sec_mcp_tool_poisoning')).toBe('MCP Tool Poisoning');
        expect(humanRuleName('sec_custom_thing')).toBe('Custom Thing');
    });
});
