import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { auditMcpConfig, evaluatePrompt, formatToSarif } from '../src';

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
        const finding = result.findings.find(item => item.workflow?.source === 'mcp_server');

        expect(finding?.workflow?.source).toBe('mcp_server');
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual(['mcp_server', 'privileged_tool', 'shell_execution', 'filesystem_access']);
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
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toContain('shell_execution');
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
        expect(finding?.workflow?.path.nodes.map(node => node.type)).toContain('filesystem_access');
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

    it('infers chained RAG to memory to tool execution without collapsing to system prompt', () => {
        const filePath = path.join(fixturesDir, 'chained-rag-memory-tool-execution.prompt');
        const result = evaluatePrompt({
            text: readFixture('chained-rag-memory-tool-execution.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_workflow_escalation');

        expect(finding?.workflow?.path.nodes.map(node => node.type)).toEqual([
            'retrieved_context',
            'agent_memory',
            'tool_router',
            'shell_execution',
        ]);
        expect(finding?.workflow?.path.summary).not.toBe('untrusted_content -> system_prompt');
    });

    it('propagates privilege backward through multi-hop chains', () => {
        const filePath = path.join(fixturesDir, 'chained-rag-memory-tool-execution.prompt');
        const result = evaluatePrompt({
            text: readFixture('chained-rag-memory-tool-execution.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_workflow_escalation');

        expect(finding?.workflow?.path.nodes.every(node => node.privilegePropagated)).toBe(true);
        expect(finding?.workflow?.path.edges.every(edge => edge.privilegePropagated)).toBe(true);
    });

    it('propagates memory taint when untrusted context persists into tools', () => {
        const filePath = path.join(fixturesDir, 'multi-hop-trust-boundary.prompt');
        const result = evaluatePrompt({
            text: readFixture('multi-hop-trust-boundary.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.path.nodes.some(node => node.type === 'agent_memory'));
        const memory = finding?.workflow?.path.nodes.find(node => node.type === 'agent_memory');
        const router = finding?.workflow?.path.nodes.find(node => node.type === 'tool_router');

        expect(memory?.tainted).toBe(true);
        expect(router?.tainted).toBe(true);
    });

    it('generates workflow explanations and risk story', () => {
        const filePath = path.join(fixturesDir, 'persistence-override-shell.prompt');
        const result = evaluatePrompt({
            text: readFixture('persistence-override-shell.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_workflow_escalation');

        expect(finding?.workflow?.path.explanation?.join('\n')).toContain('agent_memory');
        expect(finding?.workflow?.path.explanation?.join('\n')).toContain('shell_execution');
        expect(finding?.workflow?.path.riskStory).toContain('persist into agent memory');
        expect(finding?.workflow?.path.severityReason).toContain('CRITICAL');
    });

    it('preserves expanded node types in JSON workflow output', () => {
        const filePath = path.join(fixturesDir, 'credential-propagation.prompt');
        const result = evaluatePrompt({
            text: readFixture('credential-propagation.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.path.nodes.some(node => node.type === 'credential_store'));
        const nodeTypes = finding?.workflow?.path.nodes.map(node => node.type);

        expect(nodeTypes).toContain('credential_store');
        expect(nodeTypes).toContain('external_api');
        expect(finding?.workflow?.path.nodes.find(node => node.type === 'retrieved_context')?.trust).toBe('semi_trusted');
        expect(finding?.workflow?.path.nodes.find(node => node.type === 'agent_memory')?.trust).toBe('semi_trusted');
    });

    it('includes enriched workflow metadata in SARIF results', () => {
        const filePath = path.join(fixturesDir, 'chained-rag-memory-tool-execution.prompt');
        const result = evaluatePrompt({
            text: readFixture('chained-rag-memory-tool-execution.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.rule_id === 'sec_workflow_escalation');
        const sarif = JSON.parse(formatToSarif([finding as any], filePath));
        const workflow = sarif.runs[0].results[0].properties.workflow;

        expect(workflow.nodes.map((node: any) => node.type)).toContain('agent_memory');
        expect(workflow.edges.length).toBeGreaterThan(1);
        expect(workflow.confidence).toBeDefined();
        expect(workflow.explanation.join('\n')).toContain('shell_execution');
    });

    it('assigns confidence to nodes, edges, and chain', () => {
        const filePath = path.join(fixturesDir, 'autonomous-shell-execution.prompt');
        const result = evaluatePrompt({
            text: readFixture('autonomous-shell-execution.prompt'),
            context: { filePath },
        });
        const finding = result.findings.find(item => item.workflow?.path.nodes.some(node => node.type === 'shell_execution'));
        const shell = finding?.workflow?.path.nodes.find(node => node.type === 'shell_execution');
        const router = finding?.workflow?.path.nodes.find(node => node.type === 'tool_router');

        expect(shell?.confidence).toBe('high');
        expect(router?.confidence).toMatch(/medium|high/);
        expect(finding?.workflow?.path.edges.every(edge => Boolean(edge.confidence))).toBe(true);
        expect(finding?.workflow?.confidence).toBeDefined();
    });

    it('MCP privilege escalation chains through privileged tool, filesystem, and network', () => {
        const filePath = path.join(fixturesDir, 'mcp-privilege-escalation.json');
        const result = auditMcpConfig(filePath, readFixture('mcp-privilege-escalation.json'));
        const finding = result.findings.find(item => item.workflow?.source === 'mcp_server');
        const nodeTypes = finding?.workflow?.path.nodes.map(node => node.type);

        expect(nodeTypes).toEqual(['mcp_server', 'privileged_tool', 'filesystem_access', 'network_access']);
        expect(finding?.workflow?.path.privilegedSinkReached).toBe(true);
        expect(finding?.workflow?.risk).toBe('critical');
    });

    it('keeps workflow graphs deterministic across repeated scans', () => {
        const filePath = path.join(fixturesDir, 'persistence-override-shell.prompt');
        const input = {
            text: readFixture('persistence-override-shell.prompt'),
            context: { filePath },
        };
        const first = evaluatePrompt(input);
        const second = evaluatePrompt(input);
        const firstWorkflow = first.findings.find(item => item.rule_id === 'sec_workflow_escalation')?.workflow;
        const secondWorkflow = second.findings.find(item => item.rule_id === 'sec_workflow_escalation')?.workflow;

        expect(secondWorkflow?.path.summary).toBe(firstWorkflow?.path.summary);
        expect(secondWorkflow?.path.explanation).toEqual(firstWorkflow?.path.explanation);
    });
});
