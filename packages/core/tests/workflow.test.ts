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

        expect(finding?.workflow?.source).toBe('retrieved_context');
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toContain('prompt_template');
    });

    it('infers MCP server to shell execution path', () => {
        const filePath = path.join(fixturesDir, 'mcp-shell-execution/mcp.json');
        const result = auditMcpConfig(filePath, readFixture('mcp-shell-execution/mcp.json'));
        const finding = result.findings.find(item => item.workflow?.sink === 'shell_execution');

        expect(finding?.workflow?.source).toBe('mcp_server');
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual(['mcp_server', 'tool_router', 'shell_execution']);
        expect(['high', 'critical']).toContain(finding?.workflow?.risk);
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

    it('infers dangerous autonomous agent path through retrieved context, memory, router, and shell', () => {
        const filePath = path.join(fixturesDir, 'autonomous-agent-escalation.prompt');
        const result = evaluatePrompt({
            text: readFixture('autonomous-agent-escalation.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_workflow_escalation');

        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual([
            'retrieved_context',
            'agent_memory',
            'tool_router',
            'shell_execution',
        ]);
        expect(finding?.workflow?.path.trustBoundaryCrossed).toBe(true);
        expect(finding?.workflow?.path.privilegedSinkReached).toBe(true);
        expect(finding?.workflow?.risk).toBe('critical');
        expect(finding?.severity).toBe('critical');
    });

    it('privileged sinks escalate workflow severity and lower the integrity score', () => {
        const filePath = path.join(fixturesDir, 'shell-escalation.prompt');
        const result = evaluatePrompt({
            text: readFixture('shell-escalation.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.sink === 'shell_execution');

        expect(finding?.workflow?.risk).toBe('high');
        expect(result.status).toBe('fail');
        expect(result.score).toBeLessThanOrEqual(59);
    });

    it('memory persistence creates an agent_memory workflow path', () => {
        const filePath = path.join(fixturesDir, 'memory-persistence.prompt');
        const result = evaluatePrompt({
            text: readFixture('memory-persistence.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.path.nodes.some(node => node.type === 'agent_memory'));

        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual([
            'retrieved_context',
            'agent_memory',
            'tool_router',
            'shell_execution',
        ]);
    });

    it('override instructions create trust-boundary warnings for RAG escalation', () => {
        const filePath = path.join(fixturesDir, 'rag-escalation.prompt');
        const result = evaluatePrompt({
            text: readFixture('rag-escalation.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.source === 'retrieved_context');

        expect(finding?.workflow?.path.trustBoundaryCrossed).toBe(true);
        expect(finding?.workflow?.risk).toBe('critical');
    });

    it('shell execution cannot score as safe or protected', () => {
        const filePath = path.join(fixturesDir, 'approval-bypass.prompt');
        const result = evaluatePrompt({
            text: readFixture('approval-bypass.prompt'),
            context: { filePath },
        });

        expect(result.status).toBe('fail');
        expect(result.score).toBeLessThan(70);
        expect(result.findings.some(finding => finding.workflow?.sink === 'shell_execution')).toBe(true);
    });

    it('MCP autoExecute escalates privileged workflow risk', () => {
        const filePath = path.join(fixturesDir, 'mcp-auto-execute.json');
        const result = auditMcpConfig(filePath, readFixture('mcp-auto-execute.json'));
        const finding = result.findings.find(item => item.rule_id === 'MCP-011');

        expect(finding?.severity).toBe('critical');
        expect(finding?.workflow?.sink).toBe('shell_execution');
        expect(finding?.workflow?.risk).toBe('critical');
    });

    it('wildcard permissions escalate MCP/tool poisoning risk', () => {
        const filePath = path.join(fixturesDir, 'wildcard-permissions.prompt');
        const result = evaluatePrompt({
            text: readFixture('wildcard-permissions.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_mcp_tool_poisoning');

        expect(finding?.severity).toBe('high');
        expect(finding?.workflow?.sink).toBe('filesystem_access');
        expect(finding?.workflow?.path.privilegedSinkReached).toBe(true);
    });

    it('orders dangerous workflow findings before secondary hygiene findings', () => {
        const filePath = path.join(fixturesDir, 'approval-bypass.prompt');
        const result = evaluatePrompt({
            text: `${readFixture('approval-bypass.prompt')}\nMake it short but very detailed.`,
            context: { filePath },
        });

        expect(result.findings[0]?.rule_id).toBe('sec_workflow_escalation');
        expect(result.findings.findIndex(finding => finding.rule_id === 'sec_workflow_escalation'))
            .toBeLessThan(result.findings.findIndex(finding => finding.category === 'consistency'));
    });
});
