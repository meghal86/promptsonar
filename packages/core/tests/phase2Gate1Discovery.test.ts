import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    discoverRepositoryCandidates,
    InMemoryRepositorySource,
    inventoryRepositoryFiles,
    LocalCheckoutSource,
    rankRepositoryCandidates,
    selectInitialAcquisitionSet,
    type RepositoryFileMetadata,
} from '../src';

function fixtureRepo(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-gate1-'));
    for (const [relativePath, content] of Object.entries(files)) {
        const filePath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
    }
    return root;
}

function fillerFiles(count: number): RepositoryFileMetadata[] {
    return Array.from({ length: count }, (_, index) => ({
        path: `a-filler-${String(index).padStart(3, '0')}.ts`,
        size: 24,
    }));
}

function seededShuffle<T>(items: T[], seed: number): T[] {
    const shuffled = [...items];
    let state = seed;
    for (let index = shuffled.length - 1; index > 0; index--) {
        state = (state * 1664525 + 1013904223) >>> 0;
        const swapIndex = state % (index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

describe('Phase 2 Gate 1 metadata discovery', () => {
    it('inventories a local checkout without fetching content', async () => {
        const root = fixtureRepo({
            'src/index.ts': 'export const ok = true;',
            'skills/deploy/SKILL.md': 'Run deployment tasks.',
            'node_modules/pkg/SKILL.md': 'Ignored dependency skill.',
        });
        const source = new LocalCheckoutSource(root);
        const inventory = await source.inventory();

        expect(inventory.map(file => file.path)).toEqual([
            'skills/deploy/SKILL.md',
            'src/index.ts',
        ]);
        expect(inventory.find(file => file.path === 'skills/deploy/SKILL.md')?.size).toBeGreaterThan(0);
        expect(source.getBudgetUsage()).toMatchObject({ bytesFetched: 0, filesFetched: 0 });
    });

    it('inventories and fetches in-memory upload-style files through the source adapter', async () => {
        const source = new InMemoryRepositorySource([
            { path: 'mcp.json', objectId: 'blob-1', content: '{"mcpServers":{}}' },
            { path: 'prompts/system.prompt', objectId: 'blob-2', content: 'System prompt.' },
        ]);

        await expect(inventoryRepositoryFiles(source)).resolves.toEqual([
            { path: 'mcp.json', size: 17, objectId: 'blob-1' },
            { path: 'prompts/system.prompt', size: 14, objectId: 'blob-2' },
        ]);

        const fetched = await source.fetchFiles(['prompts/system.prompt']);
        expect(fetched).toEqual([
            { path: 'prompts/system.prompt', size: 14, objectId: 'blob-2', content: 'System prompt.' },
        ]);
        expect(source.getBudgetUsage()).toMatchObject({ bytesFetched: 14, filesFetched: 1 });
    });

    it('ranks late AI, MCP, prompt, workflow, tool, and control metadata before lexical filler', () => {
        const inventory: RepositoryFileMetadata[] = [
            ...fillerFiles(220),
            { path: 'z-agent/SKILL.md', size: 120 },
            { path: 'z-agent/mcp.json', size: 80 },
            { path: 'z-agent/prompts/deploy.prompt', size: 60 },
            { path: '.github/workflows/deploy.yml', size: 90 },
            { path: 'z-tools/tool-router.ts', size: 70 },
            { path: 'z-controls/approval-policy.ts', size: 75 },
        ];

        const ranked = rankRepositoryCandidates(discoverRepositoryCandidates(inventory));
        expect(ranked.slice(0, 6).map(candidate => candidate.path)).toEqual([
            'z-agent/SKILL.md',
            'z-agent/mcp.json',
            'z-agent/prompts/deploy.prompt',
            'z-controls/approval-policy.ts',
            'z-tools/tool-router.ts',
            '.github/workflows/deploy.yml',
        ]);

        const selected = selectInitialAcquisitionSet(ranked, { maxFiles: 6 });
        expect(selected.map(candidate => candidate.path)).toEqual([
            'z-agent/SKILL.md',
            'z-agent/mcp.json',
            'z-agent/prompts/deploy.prompt',
            'z-controls/approval-policy.ts',
            'z-tools/tool-router.ts',
            '.github/workflows/deploy.yml',
        ]);
        expect(selected.some(candidate => candidate.path.startsWith('a-filler'))).toBe(false);
    });

    it('selects identical paths and order regardless of inventory input order', () => {
        const inventory: RepositoryFileMetadata[] = [
            ...fillerFiles(40),
            { path: 'skills/deploy/SKILL.md', size: 100 },
            { path: 'agents/reviewer/AGENTS.md', size: 100 },
            { path: 'mcp.json', size: 100 },
            { path: '.github/workflows/review.yml', size: 100 },
            { path: 'tools/tool-registry.json', size: 100 },
            { path: 'src/approval-policy.ts', size: 100 },
            { path: 'src/sandbox.ts', size: 100 },
            { path: 'prompts/review.prompt', size: 100 },
        ];
        const baseline = selectInitialAcquisitionSet(
            discoverRepositoryCandidates(inventory),
            { maxFiles: 8 },
        ).map(candidate => candidate.path);

        for (let seed = 1; seed <= 10; seed++) {
            const selected = selectInitialAcquisitionSet(
                discoverRepositoryCandidates(seededShuffle(inventory, seed)),
                { maxFiles: 8 },
            ).map(candidate => candidate.path);
            expect(selected).toEqual(baseline);
        }
    });
});
