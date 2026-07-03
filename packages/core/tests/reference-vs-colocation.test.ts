import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { analyzeRepositoryArtifacts, buildRepositoryExecutionMap } from '../src';

// Regression for the cross-file edge-construction fix: an execution edge between
// two artifacts may ONLY be created from a REAL reference (a resolved import /
// markdown link / explicit path, or a prose file naming a configured MCP server
// by its declared name) — never from capability-word co-location (two files that
// merely both mention "shell", or that share a filename). See the wild-corpus
// false positives that motivated this: a prompt "routing to" a tool it never
// references, an AGENTS.md linked to a file only named in an ASCII directory
// tree, and a config linked to a same-named source file with no real reference.
//
// Fixtures live in ../test/fixtures/reference-vs-colocation and are scanned with
// the same engine functions `promptsonar repo` uses.

const DIR = path.resolve(__dirname, '../test/fixtures/reference-vs-colocation');

interface EdgeView {
    from?: string;
    to?: string;
    type: string;
    confidenceLabel?: string;
}

// All cross-file edges (between two discovered artifacts, not artifact->ACTION),
// with node relativePaths resolved for assertion.
function crossFileEdges(subdir: string): EdgeView[] {
    const root = path.join(DIR, subdir);
    const { artifacts } = analyzeRepositoryArtifacts(root);
    const map = buildRepositoryExecutionMap(artifacts, [], root);
    const nodeById = new Map(map.nodes.map(node => [node.id, node]));
    return map.edges
        .filter(edge => {
            const to = nodeById.get(edge.to);
            return to?.type !== 'ACTION'; // exclude artifact -> synthetic sink edges
        })
        .map(edge => ({
            from: nodeById.get(edge.from)?.relativePath,
            to: nodeById.get(edge.to)?.relativePath ?? nodeById.get(edge.to)?.label,
            type: edge.type,
            confidenceLabel: edge.confidenceLabel,
        }));
}

describe('reference-vs-colocation edge construction', () => {
    it('creates an edge when a prompt references a tool by path', () => {
        const edges = crossFileEdges('real-reference');
        const edge = edges.find(e => e.from === 'prompt.md' && e.to === 'tools/data-tool.ts');
        expect(edge).toBeTruthy();
        // A resolved path reference is direct evidence, so the edge is Confirmed.
        expect(edge?.confidenceLabel).toBe('Confirmed');
    });

    it('creates NO edge when a prompt and a tool only share a capability word', () => {
        const edges = crossFileEdges('co-location-only');
        // The prompt mentions "shell" and the tool exposes shell, but the prompt
        // never references the tool — co-location must not connect them.
        const bogus = edges.find(e => e.from === 'random-prompt.md' && e.to === 'unrelated-tool.ts');
        expect(bogus).toBeFalsy();
        // No cross-file edge of any kind should exist between the two artifacts.
        expect(edges.length).toBe(0);
    });

    it('creates an edge when a prompt names a configured MCP server', () => {
        const edges = crossFileEdges('config-reference');
        // The prompt literally names the "my-server" MCP server declared in the
        // config; the server node is labelled by its declared name.
        const edge = edges.find(e => e.from === 'prompt.md' && (e.to === 'my-server' || e.to === '.mcp.json'));
        expect(edge).toBeTruthy();
        expect(edge?.type).toBe('INVOKES');
        // A named reference (not a resolved path) is Probable, not Confirmed.
        expect(edge?.confidenceLabel).toBe('Probable');
    });
});
