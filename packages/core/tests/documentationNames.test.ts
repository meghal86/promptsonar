import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    analyzeRepositoryArtifactsFromFiles,
    inferArtifactKind,
    inferExecutionIntent,
    isDocumentationFileName,
} from '../src';

/**
 * Translated READMEs were scanned as production files: only the exact name
 * README.md counted as documentation, so mcp-client-for-ollama's README.es.md
 * and README.zh-CN.md produced critical/high findings on CLI usage examples
 * that README.md (same content, English) did not.
 */
const README = fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'documentation', 'cli-usage-readme.md'), 'utf8');

const TRANSLATIONS = ['README.es.md', 'README.zh-CN.md', 'README_ja.md', 'README-pt_BR.md', 'CONTRIBUTING.pt-BR.md', 'pkg/CHANGELOG.fr.md'];

describe('isDocumentationFileName', () => {
    it('accepts project docs and their translations', () => {
        for (const name of ['README.md', 'readme.mdx', 'README', 'README.rst', 'SECURITY.md', 'CODE_OF_CONDUCT.md', ...TRANSLATIONS]) {
            expect(isDocumentationFileName(name), name).toBe(true);
        }
    });

    it('rejects source files and AI instruction files that share a name', () => {
        for (const name of ['src/security.ts', 'history.py', 'notice.js', 'readme.ts', 'README.es.json', 'SKILL.md', 'AGENTS.md', 'readme-generator.md']) {
            expect(isDocumentationFileName(name), name).toBe(false);
        }
    });
});

describe('translated READMEs are documentation, like README.md', () => {
    it('gets the same artifact kind and execution intent as README.md', () => {
        const english = [inferArtifactKind('README.md'), inferExecutionIntent('README.md')];
        expect(english).toEqual(['documentation', 'reference']);
        for (const name of TRANSLATIONS) {
            expect([inferArtifactKind(name), inferExecutionIntent(name)], name).toEqual(english);
        }
    });

    it('gets documentation provenance in the repository pipeline', () => {
        const files = ['README.md', ...TRANSLATIONS].map(name => ({ path: name, content: README }));
        const provenance = new Map(
            analyzeRepositoryArtifactsFromFiles('/repo', [
                ...files,
                // A real prompt beside them keeps the scan non-empty.
                { path: 'prompts/system.prompt', content: 'You are a helpful assistant. {{input}}' },
            ]).artifacts.map(artifact => [artifact.relativePath, artifact.provenance]),
        );
        expect(provenance.get('prompts/system.prompt')).toBe('production');
        for (const name of ['README.md', ...TRANSLATIONS]) {
            // Documentation is not classified as an executable artifact at all.
            expect(provenance.get(name) ?? 'not-an-artifact', name).not.toBe('production');
        }
    });
});
