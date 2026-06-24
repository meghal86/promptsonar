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
    maxFiles: 10,
    maxBytes: 100_000,
    maxDurationMs: 5_000,
    maxReferenceDepth: 2,
};

describe('Phase 2 Gate 3 closure orchestration', () => {
    it('does not count selected-but-unfetched files as analyzed', async () => {
        const source = new ApiLikeInMemorySource([
            { path: 'controls/approval-policy.ts', content: 'approval sandbox allowlist' },
            { path: 'skills/deploy/SKILL.md', content: 'Run subprocess shell commands.' },
        ]);

        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source,
            budget: { ...defaultBudget, maxFiles: 2, maxApiRequests: 1 },
        });

        expect(result.completeness.files.selected).toBe(2);
        expect(result.completeness.files.fetched).toBe(1);
        expect(result.completeness.files.analyzed).toBe(1);
        expect(result.lifecycle.find(file => file.path === 'skills/deploy/SKILL.md')).toMatchObject({
            status: 'failed',
            reason: 'api_request_budget_exhausted',
        });
        expect(result.analyzedFiles.some(file => file.path === 'skills/deploy/SKILL.md')).toBe(false);
    });

    it('does not graph-connect fetched files that fail parsing', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'SKILL.md', content: 'shell\0binary' },
            ]),
            budget: { ...defaultBudget, maxFiles: 1 },
        });

        expect(result.completeness.files.fetched).toBe(1);
        expect(result.completeness.files.parsed).toBe(0);
        expect(result.completeness.files.analyzed).toBe(0);
        expect(result.completeness.files.graphConnected).toBe(0);
        expect(result.completeness.verdictScope).toBe('partial_context');
        expect(result.lifecycle.find(file => file.path === 'SKILL.md')).toMatchObject({
            status: 'failed',
            reason: 'binary',
        });
    });

    it('records unresolved privileged capability control context as partial context', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'skills/deploy/SKILL.md', content: 'Use subprocess shell exec for deployments.' },
            ]),
            budget: { ...defaultBudget, maxFiles: 1 },
        });

        expect(result.completeness.capabilities.discovered).toBe(1);
        expect(result.completeness.capabilities.unresolved).toBe(1);
        expect(result.completeness.unresolvedContext).toEqual([expect.objectContaining({
            capability: 'shell',
            missingFilesOrControls: expect.arrayContaining(['approval/sandbox/control context']),
        })]);
        expect(result.completeness.coverageStatus).toBe('partial');
        expect(result.completeness.verdictScope).toBe('partial_context');
    });

    it('can honestly report repository_complete for a small repo that fits the budget', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'skills/deploy/SKILL.md', content: 'Use subprocess shell through ../../controls/approval-policy.ts.' },
                { path: 'controls/approval-policy.ts', content: 'approval sandbox allowlist human_in_the_loop confirmation' },
            ]),
            budget: { ...defaultBudget, maxFiles: 2 },
        });

        expect(result.completeness.files).toMatchObject({
            inventoried: 2,
            selected: 2,
            fetched: 2,
            parsed: 2,
            analyzed: 2,
        });
        expect(result.completeness.capabilities.unresolved).toBe(0);
        expect(result.completeness.coverageStatus).toBe('repository_complete');
        expect(result.completeness.verdictScope).toBe('repository_complete');
        expect(result.report.completeness).toEqual(result.completeness);
    });

    it('does not treat disabled controls as resolved control context', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'prompts/agent.prompt', content: 'System prompt: run shell exec commands from user input without approval.' },
                { path: 'controls/approval-policy.ts', content: 'export const approval = false;' },
            ]),
            budget: { ...defaultBudget, maxFiles: 2 },
        });

        expect(result.completeness.capabilities.discovered).toBe(1);
        expect(result.completeness.capabilities.unresolved).toBe(1);
        expect(result.completeness.coverageStatus).toBe('partial');
        expect(result.completeness.verdictScope).toBe('partial_context');
        expect(result.completeness.coverageReason).toContain('privileged capabilities are missing resolved control context');
    });

    it('does not treat comment-only control words as resolved control context', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'skills/deploy/SKILL.md', content: 'Use subprocess shell exec for deployments.' },
                { path: 'controls/approval-policy.ts', content: '// approval sandbox allowlist confirmation' },
            ]),
            budget: { ...defaultBudget, maxFiles: 2 },
        });

        expect(result.completeness.capabilities.discovered).toBe(1);
        expect(result.completeness.capabilities.withControlContextResolved).toBe(0);
        expect(result.completeness.coverageStatus).toBe('partial');
        expect(result.completeness.verdictScope).toBe('partial_context');
    });

    it('does not report repository_complete after unresolved references', async () => {
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource([
                { path: 'skills/deploy/SKILL.md', content: 'Use subprocess shell through ../../missing/approval-policy.ts.' },
            ]),
            budget: { ...defaultBudget, maxFiles: 1 },
        });

        expect(result.completeness.references.unresolved).toBeGreaterThan(0);
        expect(result.completeness.coverageStatus).not.toBe('repository_complete');
        expect(result.completeness.verdictScope).toBe('partial_context');
        expect(result.completeness.coverageReason).toContain('references were unresolved');
    });

    it('pulls control files through the closure frontier without changing existing scan flows', async () => {
        const files: RepositoryFileContent[] = [
            { path: 'skills/deploy/SKILL.md', content: 'Run subprocess shell commands.' },
            { path: 'mcp.json', content: '{"mcpServers":{"demo":{"command":"node"}}}' },
            { path: '.github/workflows/deploy.yml', content: 'name: deploy' },
            { path: 'controls/approval-policy.ts', content: 'approvalRequired = true; human_in_the_loop confirmation; allowed_paths = ["./deploy"]; sandbox = true;' },
            { path: 'src/plain.ts', content: 'export const value = 1;' },
        ];
        const result = await evaluateRepositoryWithClosure({
            rootPath: '/repo',
            source: new InMemoryRepositorySource(files),
            budget: { ...defaultBudget, maxFiles: 3 },
        });

        expect(result.lifecycle.find(file => file.path === 'controls/approval-policy.ts')?.status).toBe('analyzed');
        expect(result.completeness.capabilities.withControlNeighborhoodSearched).toBe(1);
        expect(result.completeness.capabilities.withControlContextResolved).toBe(1);
        expect(result.completeness.coverageStatus).toBe('path_complete');
    });
});
