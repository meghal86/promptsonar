import { describe, expect, it } from 'vitest';
import { isPromptFile, isPromptFileName, isMcpConfigFile, isScannable } from '../src/shared/detection';

describe('prompt file detection (Feature 1)', () => {
    it('detects .prompt and .prompt.* files', () => {
        expect(isPromptFileName('agent.prompt')).toBe(true);
        expect(isPromptFileName('system.prompt.md')).toBe(true);
        expect(isPromptFileName('x.prompt.yaml')).toBe(true);
        expect(isPromptFileName('x.prompt.json')).toBe(true);
    });

    it('detects structured prompt/agent/system configs by name', () => {
        expect(isPromptFileName('system-prompt.json')).toBe(true);
        expect(isPromptFileName('agent.config.yaml')).toBe(true);
        expect(isPromptFileName('claude.json')).toBe(true);
    });

    it('does not flag ordinary structured config files', () => {
        expect(isPromptFileName('package.json')).toBe(false);
        expect(isPromptFileName('tsconfig.json')).toBe(false);
        expect(isPromptFileName('docker-compose.yaml')).toBe(false);
    });

    it('treats md/txt as prompts, gated by chat content when provided', () => {
        expect(isPromptFile('notes.md')).toBe(true);
        expect(isPromptFile('notes.md', 'just prose here')).toBe(false);
        expect(isPromptFile('chat.md', 'system: you are a bot')).toBe(true);
    });

    it('detects MCP config files (Feature 11)', () => {
        expect(isMcpConfigFile('mcp.json')).toBe(true);
        expect(isMcpConfigFile('mcp.yaml')).toBe(true);
        expect(isMcpConfigFile('mcp.config.json')).toBe(true);
        expect(isMcpConfigFile('file:///proj/.cursor/mcp.json')).toBe(true);
        expect(isMcpConfigFile('project.mcp.json')).toBe(true);
        expect(isMcpConfigFile('package.json')).toBe(false);
    });

    it('isScannable unions prompt + mcp detection', () => {
        expect(isScannable('agent.prompt')).toBe(true);
        expect(isScannable('mcp.json')).toBe(true);
        expect(isScannable('package.json')).toBe(false);
    });
});
