import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { auditMcpConfig, evaluatePrompt } from '../src';

const fixturesDir = path.resolve(__dirname, '../test/fixtures/workflows');

function readFixture(name: string): string {
    return fs.readFileSync(path.join(fixturesDir, name), 'utf-8');
}

describe('AI workflow security analysis', () => {
    it('infers user input to privileged tool execution for injection near tool routing', () => {
        const filePath = path.join(fixturesDir, 'prompt-to-tool-execution.prompt');
        const result = evaluatePrompt({
            text: readFixture('prompt-to-tool-execution.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_owasp_llm01_injection');
        const bestPracticeFinding = result.findings.find(item => item.rule_id === 'bp_missing_persona');

        expect(finding?.workflow?.source).toBe('user_input');
        expect(finding?.workflow?.sink).toBe('shell_execution');
        expect(finding?.workflow?.path.privilegedSinkReached).toBe(true);
        expect(finding?.workflow?.path.trustBoundaryCrossed).toBe(true);
        expect(bestPracticeFinding?.workflow).toBeUndefined();
    });

    it('infers retrieved RAG context to prompt template path', () => {
        const filePath = path.join(fixturesDir, 'rag-to-prompt-template.prompt');
        const result = evaluatePrompt({
            text: readFixture('rag-to-prompt-template.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_rag_injection');

        expect(finding?.workflow?.source).toBe('rag_context');
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toContain('prompt_template');
    });

    it('infers MCP server to shell execution path', () => {
        const filePath = path.join(fixturesDir, 'mcp-shell-execution/mcp.json');
        const result = auditMcpConfig(filePath, readFixture('mcp-shell-execution/mcp.json'));
        const finding = result.findings.find(item => item.workflow?.sink === 'shell_execution');

        expect(finding?.workflow?.source).toBe('mcp_server');
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual(['mcp_server', 'mcp_tool', 'shell_execution']);
        expect(finding?.workflow?.risk).toBe('high');
    });

    it('infers untrusted content through memory to the tool router', () => {
        const filePath = path.join(fixturesDir, 'memory-to-tool-router.prompt');
        const result = evaluatePrompt({
            text: readFixture('memory-to-tool-router.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_owasp_llm01_injection');

        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual(['user_input', 'agent_memory', 'tool_router']);
        expect(finding?.workflow?.sink).toBe('tool_router');
    });

    it('does not invent workflow paths for benign non-security findings', () => {
        const filePath = path.join(fixturesDir, 'benign-prompt-no-workflow.prompt');
        const result = evaluatePrompt({
            text: readFixture('benign-prompt-no-workflow.prompt'),
            context: { filePath },
        });

        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.findings.every(finding => finding.workflow === undefined)).toBe(true);
    });
});
