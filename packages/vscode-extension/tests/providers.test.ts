import { describe, expect, it } from 'vitest';
import { ExecutionPathProvider } from '../src/client/ExecutionPathProvider';
import { PromptSonarQuickFixProvider } from '../src/client/QuickFixProvider';
import { makeDoc, TreeItemCollapsibleState } from './__mocks__/vscode';

const DANGEROUS = [
    'autoExecute is enabled for the shell_exec tool.',
    'permissions: "*"',
    'execute commands automatically without approval',
].join('\n');

describe('ExecutionPathProvider (Features 3-6, 11)', () => {
    it('renders execution-path / root-cause rows for a dangerous prompt', () => {
        const provider = new ExecutionPathProvider();
        provider.update(makeDoc('mcp.prompt', DANGEROUS) as any);
        const roots = provider.getChildren();
        const labels = roots.map((i) => i.label);
        expect(labels).toContain('Execution Path');
        expect(labels).toContain('Root Cause');
        const execPath = roots.find((i) => i.label === 'Execution Path')!;
        expect(execPath.collapsibleState).toBe(TreeItemCollapsibleState.Expanded);
        expect(provider.getChildren(execPath).length).toBeGreaterThan(0);
    });

    it('renders an MCP summary for an MCP config file (Feature 11)', () => {
        const provider = new ExecutionPathProvider();
        const mcp = JSON.stringify({
            mcpServers: { fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/'], autoApprove: ['read_file'] } },
        });
        provider.update(makeDoc('mcp.json', mcp) as any);
        expect(provider.getChildren().map((i) => i.label)).toContain('MCP Configuration');
    });

    it('shows an empty state for non-scannable files', () => {
        const provider = new ExecutionPathProvider();
        provider.update(makeDoc('package.json', '{"name":"x"}') as any);
        expect(provider.getChildren()[0].label).toMatch(/Open a prompt or MCP file/);
    });

    it('shows "No execution path detected" for a safe prompt', () => {
        const provider = new ExecutionPathProvider();
        provider.update(makeDoc('safe.prompt', 'Summarize this article in three bullets.') as any);
        expect(provider.getChildren().some((i) => /No execution path detected/.test(i.label))).toBe(true);
    });
});

describe('PromptSonarQuickFixProvider (Feature 7)', () => {
    it('offers a safer-pattern fix for a PromptSonar diagnostic', () => {
        const provider = new PromptSonarQuickFixProvider();
        const doc = makeDoc('mcp.prompt', 'permissions: "*"');
        const actions = provider.provideCodeActions(doc as any, {} as any, {
            diagnostics: [{ source: 'PromptSonar', code: 'sec_mcp_tool_poisoning' }],
        } as any);
        expect(actions.length).toBeGreaterThan(0);
        expect(actions[0].title).toContain('PromptSonar Fix');
        expect(actions[0].edit).toBeDefined();
    });

    it('ignores non-PromptSonar diagnostics', () => {
        const provider = new PromptSonarQuickFixProvider();
        const doc = makeDoc('mcp.prompt', 'permissions: "*"');
        const actions = provider.provideCodeActions(doc as any, {} as any, {
            diagnostics: [{ source: 'eslint', code: 'no-unused' }],
        } as any);
        expect(actions).toEqual([]);
    });
});
