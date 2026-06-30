import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { analyzeRepositoryArtifacts } from '../src';

// Regression fixture for the classifier exclusion layer and the top-level
// `memory/` classification fix. The fixture mixes real AI artifacts with
// build, dependency, and test files that previously produced false positives.
const fixtureDir = path.resolve(__dirname, '../test/fixtures/discovery-accuracy');

describe('discovery accuracy (classifier exclusion + memory)', () => {
    const { artifacts } = analyzeRepositoryArtifacts(fixtureDir);
    const typeByPath = new Map(artifacts.map(a => [a.relativePath, a.type]));

    it('classifies AI artifacts with the expected type', () => {
        expect(typeByPath.get('memory/context.yaml')).toBe('MEMORY');
        expect(typeByPath.get('src/memory/index.ts')).toBe('MEMORY');
        expect(typeByPath.get('src/everything/AGENTS.md')).toBe('AGENT_CONFIG');
        expect(typeByPath.get('CLAUDE.md')).toBe('AGENT_CONFIG');
        expect(typeByPath.get('.cursorrules')).toBe('AGENT_CONFIG');
        expect(typeByPath.get('.mcp.json')).toBe('MCP_SERVER');
    });

    it('excludes build, dependency, and test files from classification', () => {
        for (const excluded of [
            'src/memory/package.json',
            'src/memory/tsconfig.json',
            'src/memory/__tests__/mem.test.ts',
            'src/everything/__tests__/tools.test.ts',
        ]) {
            expect(typeByPath.has(excluded)).toBe(false);
        }
    });

    it('leaks no excluded-class file into the artifact list', () => {
        const leaked = artifacts.filter(a =>
            /(^|\/)__tests__\//.test(a.relativePath)
            || /\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs)$/.test(a.relativePath)
            || /(^|\/)(package\.json|tsconfig\.json|readme\.md)$/i.test(a.relativePath));
        expect(leaked).toEqual([]);
    });
});
