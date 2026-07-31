import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateSarif, scanFiles } from '../src/scanner-bridge';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-action-test-'));
}

describe('GitHub Action scanner bridge contextual MCP scoring', () => {
    it('does not depress action score for capability-only MCP shell findings', async () => {
        const dir = makeTempDir();
        const mcpPath = path.join(dir, 'mcp.json');
        fs.writeFileSync(mcpPath, JSON.stringify({
            schemaVersion: '2026-05-20',
            mcpServers: {
                shell: {
                    command: 'node',
                    args: ['server.js'],
                    capabilities: ['shell'],
                },
            },
        }), 'utf-8');

        const results = await scanFiles(mcpPath, {});
        const finding = results[0].findings.find(item => item.rule_id === 'MCP-104');
        const sarif = JSON.parse(generateSarif(results));
        const sarifFinding = sarif.runs[0].results.find((item: any) => item.ruleId === 'MCP-104');

        expect(finding).toMatchObject({ severity: 'low', context: { verdict: 'needs_more_context' } });
        expect(finding?.context?.vulnerabilityBasis).toBeUndefined();
        expect(results[0].overall_score).toBe(95);
        expect(results[0].status).toBe('warn');
        expect(sarifFinding.level).toBe('note');
        expect(sarifFinding.properties.contextual_verdict).toBe('needs_more_context');
    });
});
