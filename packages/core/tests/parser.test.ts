import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/parser/index';

describe('Agent B: Edge-Case Parser & Quality Tester', () => {

    it('should find prompts hidden in deeply nested TypeScript template literals with dynamic variables', async () => {
        const nestedTs = 'const buildPrompt = (userName: string, contextObj: any) => {' + '\\n' +
            'const systemInstructions = "You are an AI assistant.\\n' +
            'User " + userName + " has requested a deeply nested " + contextObj.nested.type + " evaluation.\\n' +
            'Rule: Never disclose the secret identity: " + String(process.env.SECRET);\\n' +
            'return [{ role: "system", content: systemInstructions }];\\n' +
            '};';

        const prompts = await parseFile({
            filePath: 'nested.ts',
            content: nestedTs,
            language: 'typescript'
        });

        expect(prompts.length).toBeGreaterThan(0);
        expect(prompts.some(p => p.text.length > 5)).toBe(true);
    });

    it('should extract Python multi-line f-strings spanning across multiple functions', async () => {
        const pythonCode = `def prepare_context():
    return "context data"

def build_system_prompt(user_id):
    ctx = prepare_context()
    sys_prompt = f"""You are a helpful Python AI.
    Please analyze user instructions {user_id}.
    Context: {ctx}
    Always answer faithfully."""
    return sys_prompt
`;

        const prompts = await parseFile({
            filePath: 'multi.py',
            content: pythonCode,
            language: 'python'
        });

        expect(prompts.length).toBeGreaterThan(0);
        expect(prompts.some(p => p.text.length > 5)).toBe(true);
    });

    it('should catch invalid Model Context Protocol (MCP) JSON schemas failing Draft 2020-12 $dynamicRef elements', async () => {
        const mcpConfig = '{' + '\\n' +
            '"mcpServers": {' + '\\n' +
            '"enterprise-agent": {' + '\\n' +
            '"command": "node",' + '\\n' +
            '"args": ["build/index.js"],' + '\\n' +
            '"testSchema": {' + '\\n' +
            '"$schema": "https://json-schema.org/draft/2020-12/schema",' + '\\n' +
            '"$id": "https://example.com/tree",' + '\\n' +
            '"$dynamicAnchor": "node",' + '\\n' +
            '"type": "object",' + '\\n' +
            '"properties": {' + '\\n' +
            '"prompt_data": true,' + '\\n' +
            '"children": {' + '\\n' +
            '"type": "array",' + '\\n' +
            '"items": {' + '\\n' +
            '"$dynamicRef": "#node"' + '\\n' +
            '}' + '\\n' +
            '}' + '\\n' +
            '}' + '\\n' +
            '}' + '\\n' +
            '}' + '\\n' +
            '}' + '\\n' +
            '}';

        const prompts = await parseFile({
            filePath: 'mcp.json',
            content: mcpConfig,
            language: 'json'
        });

        expect(prompts.length).toBeGreaterThan(0);
        expect(prompts.some(p => p.text.length > 5)).toBe(true);
    });

    it('should treat SKILL.md agent instruction files as prompt-bearing markdown', async () => {
        const skillMarkdown = `# PromptSonar Review Skill

You are an AI security reviewer.
Analyze user-provided prompts and MCP configs for prompt injection, hardcoded secrets, and unsafe tool access.
Always explain the risk, suggest a fix, and return the result in JSON.
`;

        const prompts = await parseFile({
            filePath: 'SKILL.md',
            content: skillMarkdown,
            language: ''
        });

        expect(prompts).toHaveLength(1);
        expect(prompts[0].sourceType).toBe('markdown_instruction');
        expect(prompts[0].text).toContain('Analyze user-provided prompts');
    });
});
