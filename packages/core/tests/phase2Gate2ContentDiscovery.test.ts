import { describe, expect, it } from 'vitest';
import {
    analyzeFetchedFiles,
    discoverRepositoryCandidates,
    enrichCandidates,
    extractReferences,
    findControlNeighborhood,
    InMemoryRepositorySource,
    rankContentEnrichedCandidates,
    selectInitialAcquisitionSet,
    type RepositoryFileMetadata,
} from '../src';

function seededShuffle<T>(items: T[], seed: number): T[] {
    const shuffled = [...items];
    let state = seed;
    for (let index = shuffled.length - 1; index > 0; index--) {
        state = (state * 1103515245 + 12345) >>> 0;
        const swapIndex = state % (index + 1);
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

describe('Phase 2 Gate 2 content discovery', () => {
    it('analyzes only fetched files and never puts selected-but-unfetched files in the frontier', () => {
        const selectedPaths = ['skills/deploy/SKILL.md', 'controls/approval-policy.ts'];
        const analysis = analyzeFetchedFiles([{
            path: 'skills/deploy/SKILL.md',
            content: 'Use subprocess shell execution for deployment.',
        }], { selectedPaths });

        expect(analysis.selectedPaths).toEqual(['controls/approval-policy.ts', 'skills/deploy/SKILL.md']);
        expect(analysis.fetchedPaths).toEqual(['skills/deploy/SKILL.md']);
        expect(analysis.successful.map(file => file.path)).toEqual(['skills/deploy/SKILL.md']);
        expect(analysis.successful.some(file => file.path === 'controls/approval-policy.ts')).toBe(false);
    });

    it('extracts references only from analyzed files', () => {
        const inventory: RepositoryFileMetadata[] = [
            { path: 'skills/deploy/SKILL.md', size: 100 },
            { path: 'controls/approval-policy.ts', size: 80 },
            { path: 'controls/sandbox.ts', size: 70 },
        ];
        const analysis = analyzeFetchedFiles([{
            path: 'skills/deploy/SKILL.md',
            content: 'Run shell commands only through "../../controls/approval-policy.ts".',
        }], {
            selectedPaths: ['skills/deploy/SKILL.md', 'controls/sandbox.ts'],
        });

        const references = extractReferences(analysis.successful, inventory);
        expect(references.resolved).toEqual(['controls/approval-policy.ts']);
        expect(references.candidates.map(candidate => candidate.path)).toEqual(['controls/approval-policy.ts']);
        expect(references.resolved).not.toContain('controls/sandbox.ts');
    });

    it('discovers control-neighborhood files for analyzed privileged capabilities', () => {
        const inventory: RepositoryFileMetadata[] = [
            { path: 'skills/deploy/SKILL.md', size: 100 },
            { path: 'controls/approval-policy.ts', size: 80 },
            { path: 'controls/sandbox.ts', size: 70 },
            { path: 'src/unrelated.ts', size: 40 },
        ];
        const analysis = analyzeFetchedFiles([{
            path: 'skills/deploy/SKILL.md',
            content: 'Use shell and subprocess for deploy tasks.',
        }]);
        const references = extractReferences(analysis.successful, inventory);
        const controls = findControlNeighborhood(analysis.successful, references, inventory);

        expect(new Set(controls.map(candidate => candidate.path))).toEqual(new Set([
            'controls/approval-policy.ts',
            'controls/sandbox.ts',
        ]));
    });

    it('reranks from content signals only after content is fetched and analyzed', () => {
        const inventory: RepositoryFileMetadata[] = [
            { path: 'src/executor.ts', size: 80 },
            { path: 'src/plain.ts', size: 20 },
            { path: 'README.md', size: 10 },
        ];
        const metadataCandidates = discoverRepositoryCandidates(inventory);
        const beforeFetch = rankContentEnrichedCandidates(enrichCandidates(metadataCandidates, analyzeFetchedFiles([])));
        expect(beforeFetch[0].path).toBe('README.md');
        expect(beforeFetch.find(candidate => candidate.path === 'src/executor.ts')?.capabilitySignals).toEqual([]);

        const afterFetch = rankContentEnrichedCandidates(enrichCandidates(metadataCandidates, analyzeFetchedFiles([{
            path: 'src/executor.ts',
            content: 'import OpenAI from "openai"; child_process.spawn("bash");',
        }])));
        expect(afterFetch[0].path).toBe('src/executor.ts');
        expect(afterFetch[0].capabilitySignals).toContain('shell');
        expect(afterFetch[0].frameworkSignals).toContain('OpenAI');
    });

    it('tracks request budget usage and stops fetching when the request cap is reached', async () => {
        const source = new InMemoryRepositorySource([
            { path: 'a.prompt', content: 'a' },
            { path: 'b.prompt', content: 'b' },
            { path: 'c.prompt', content: 'c' },
        ], 2);

        const fetched = await source.fetchFiles(['a.prompt', 'b.prompt', 'c.prompt'], { requestCost: 1 });

        expect(fetched.map(file => file.path)).toEqual(['a.prompt', 'b.prompt']);
        expect(source.getBudgetUsage()).toMatchObject({
            requestsUsed: 2,
            requestLimit: 2,
            filesFetched: 2,
            bytesFetched: 2,
        });
    });

    it('keeps content-enriched selection deterministic under shuffled metadata and fetch order', () => {
        const inventory: RepositoryFileMetadata[] = [
            { path: 'skills/deploy/SKILL.md', size: 100 },
            { path: 'mcp.json', size: 100 },
            { path: 'src/executor.ts', size: 100 },
            { path: 'src/approval-policy.ts', size: 100 },
            { path: 'src/sandbox.ts', size: 100 },
            { path: 'prompts/deploy.prompt', size: 100 },
            ...Array.from({ length: 20 }, (_, index) => ({ path: `filler-${index}.ts`, size: 20 })),
        ];
        const fetched = [
            { path: 'src/executor.ts', content: 'subprocess shell exec with process.env token' },
            { path: 'src/approval-policy.ts', content: 'approval allowlist human_in_the_loop confirmation' },
            { path: 'skills/deploy/SKILL.md', content: 'Use shell via ../src/executor.ts and ../src/approval-policy.ts' },
        ];
        const baselineMetadata = discoverRepositoryCandidates(inventory);
        const baselineAnalysis = analyzeFetchedFiles(fetched);
        const baseline = selectInitialAcquisitionSet(
            rankContentEnrichedCandidates(enrichCandidates(baselineMetadata, baselineAnalysis)),
            { maxFiles: 5 },
        ).map(candidate => candidate.path);

        for (let seed = 1; seed <= 8; seed++) {
            const metadata = discoverRepositoryCandidates(seededShuffle(inventory, seed));
            const analysis = analyzeFetchedFiles(seededShuffle(fetched, seed + 10));
            const selected = selectInitialAcquisitionSet(
                rankContentEnrichedCandidates(enrichCandidates(metadata, analysis)),
                { maxFiles: 5 },
            ).map(candidate => candidate.path);
            expect(selected).toEqual(baseline);
        }
    });
});
