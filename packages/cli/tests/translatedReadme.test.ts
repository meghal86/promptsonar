import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanFiles } from '../src/scanner';

// Real case: mcp-client-for-ollama's README.es.md and README.zh-CN.md got
// critical/high findings on CLI usage examples, while README.md with the same
// examples got low. Translating or renaming a README must not change results.
const README = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'core', 'test', 'fixtures', 'documentation', 'cli-usage-readme.md'),
    'utf8',
);

describe('scan: translated READMEs', () => {
    it('reports the same findings for README.md and its translations', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-readme-'));
        try {
            const names = ['README.md', 'README.es.md', 'README.zh-CN.md', 'README_ja.md'];
            for (const name of names) fs.writeFileSync(path.join(root, name), README);

            const results = await scanFiles(root, {});
            const view = (name: string) => (results.find(result => path.basename(result.filePath) === name)?.findings || [])
                .map(finding => `${finding.rule_id}:${finding.severity}`)
                .sort();

            for (const name of names.slice(1)) expect(view(name), name).toEqual(view('README.md'));
            for (const name of names) {
                expect(view(name).some(entry => /:(critical|high)$/.test(entry)), name).toBe(false);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
