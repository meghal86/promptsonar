import { describe, expect, it } from 'vitest';
import { auditMcpConfig, formatToSarif } from '@promptsonar/core';
import { contextualizeMcpAuditForActiveDocument } from '../src/client/mcpContextual';

describe('VS Code MCP active-document contextualization', () => {
    it('does not export capability-only MCP shell findings as raw critical SARIF', () => {
        const audit = auditMcpConfig('/repo/.cursor/mcp.json', JSON.stringify({
            schemaVersion: '2026-05-20',
            mcpServers: {
                shell: {
                    command: 'node',
                    args: ['server.js'],
                    capabilities: ['shell'],
                },
            },
        }));
        const { findings, mcpAudit } = contextualizeMcpAuditForActiveDocument(audit);
        const finding = findings.find(item => item.rule_id === 'MCP-104') as any;
        const sarif = JSON.parse(formatToSarif(findings.map(item => ({
            ...item,
            filePath: '/repo/.cursor/mcp.json',
            line: 1,
            column: 1,
        })) as any, '/repo/.cursor/mcp.json'));
        const sarifFinding = sarif.runs[0].results.find((item: any) => item.ruleId === 'MCP-104');

        expect(mcpAudit.status).toBe('warn');
        expect(finding).toMatchObject({ severity: 'low', context: { verdict: 'needs_more_context' } });
        expect(finding.context.vulnerabilityBasis).toBeUndefined();
        expect(sarifFinding.level).toBe('note');
        expect(sarifFinding.properties.contextual_verdict).toBe('needs_more_context');
    });
});
