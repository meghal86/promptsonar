import { describe, expect, it } from 'vitest';
import {
    evaluateRepositoryWithClosure,
    InMemoryRepositorySource,
    type RepositoryFileContent,
} from '../src';

class ApiLikeInMemorySource extends InMemoryRepositorySource {
    getCapabilities() {
        return {
            localSearch: false,
            archiveDownload: false,
            concurrentFetch: true,
            blobCache: true,
        };
    }
}

const defaultBudget = {
    maxFiles: 6,
    maxBytes: 100_000,
    maxDurationMs: 5_000,
    maxReferenceDepth: 2,
};

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

function selectedLifecycle(result: Awaited<ReturnType<typeof evaluateRepositoryWithClosure>>) {
    return result.lifecycle
        .filter(file => file.status !== 'inventoried')
        .map(file => ({ path: file.path, status: file.status, reason: file.reason }));
}

function findingProjection(result: Awaited<ReturnType<typeof evaluateRepositoryWithClosure>>) {
    return result.report.issues.map(issue => ({
        id: issue.id,
        ruleId: issue.ruleId,
        verdict: issue.context?.verdict,
        severity: issue.severity,
        pathIds: issue.pathIds,
    })).sort((a, b) => a.id.localeCompare(b.id));
}

describe('Phase 2 Gate 5 conformance and regressions', () => {
    it('keeps closure selection and findings deterministic under shuffled source input', async () => {
        const files: RepositoryFileContent[] = [
            { path: 'skills/deploy/SKILL.md', content: 'Use subprocess shell through ../../controls/approval-policy.ts.' },
            { path: 'controls/approval-policy.ts', content: 'approval sandbox allowlist human_in_the_loop confirmation' },
            { path: 'mcp.json', content: '{"mcpServers":{"shell":{"command":"bash"}}}' },
            { path: '.github/workflows/deploy.yml', content: 'name: deploy' },
            { path: 'prompts/deploy.prompt', content: 'Run the deployment workflow.' },
            { path: 'src/plain.ts', content: 'export const ok = true;' },
        ];
        const baseline = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource(files),
            budget: defaultBudget,
        });

        for (let seed = 1; seed <= 8; seed++) {
            const result = await evaluateRepositoryWithClosure({
                rootPath: '/repo',
                source: new InMemoryRepositorySource(seededShuffle(files, seed)),
                budget: defaultBudget,
            });
            expect(selectedLifecycle(result)).toEqual(selectedLifecycle(baseline));
            expect(findingProjection(result)).toEqual(findingProjection(baseline));
            expect(result.completeness).toEqual(baseline.completeness);
        }
    });

    it('demonstrates first-N baseline misses late AI/control files while closure selects them', async () => {
        const filler = Array.from({ length: 220 }, (_, index) => ({
            path: `a-filler-${String(index).padStart(3, '0')}.ts`,
            content: 'export const filler = true;',
        }));
        const files: RepositoryFileContent[] = [
            ...filler,
            { path: 'z-agent/skills/deploy/SKILL.md', content: 'Use subprocess shell through ../../../z-controls/approval-policy.ts.' },
            { path: 'z-controls/approval-policy.ts', content: 'approval sandbox allowlist human_in_the_loop confirmation' },
        ];
        const firstNPaths = [...files].map(file => file.path).sort().slice(0, 200);
        expect(firstNPaths).not.toContain('z-agent/skills/deploy/SKILL.md');
        expect(firstNPaths).not.toContain('z-controls/approval-policy.ts');

        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource(files),
            budget: { ...defaultBudget, maxFiles: 4 },
        });
        const selected = new Set(selectedLifecycle(result).map(file => file.path));
        expect(selected.has('z-agent/skills/deploy/SKILL.md')).toBe(true);
        expect(selected.has('z-controls/approval-policy.ts')).toBe(true);
        expect(result.completeness.capabilities.withControlContextResolved).toBe(1);
    });

    it('keeps request-budget exhaustion partial and never repository_complete', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new ApiLikeInMemorySource([
                { path: 'a-skills/deploy/SKILL.md', content: 'Use subprocess shell exec for deployments.' },
                { path: 'z-controls/approval-policy.ts', content: 'approval sandbox allowlist' },
            ]),
            budget: { ...defaultBudget, maxFiles: 2, maxApiRequests: 1 },
        });

        expect(result.acquisition.requestsUsed).toBe(1);
        expect(result.completeness.coverageStatus).not.toBe('repository_complete');
        expect(result.completeness.verdictScope).toBe('partial_context');
        expect(result.completeness.coverageReason).toContain('API request budget was exhausted');
        expect(result.report.issues.some(issue => issue.context?.verdict === 'needs_more_context')).toBe(true);
    });
});
