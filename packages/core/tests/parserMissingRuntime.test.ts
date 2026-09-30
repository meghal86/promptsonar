import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CORE_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(CORE_ROOT, 'dist');

/**
 * A deployment that bundles web-tree-sitter's JS but not tree-sitter.wasm (e.g.
 * a serverless trace that misses the asset) used to abort with an uncaught
 * exception and leave the init promise pending forever — every request that
 * loaded grammars then hung until the client timed out.
 */
describe('parser without the tree-sitter runtime file', () => {
    it('fails fast so capability detection falls back to keywords', () => {
        expect(fs.existsSync(path.join(DIST, 'index.js'))).toBe(true);

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-no-wasm-'));
        try {
            fs.cpSync(DIST, path.join(tmp, 'dist'), { recursive: true });
            // Stub web-tree-sitter: the real JS, but no tree-sitter.wasm beside it.
            const realPkg = path.join(CORE_ROOT, 'node_modules', 'web-tree-sitter');
            const stubPkg = path.join(tmp, 'node_modules', 'web-tree-sitter');
            fs.mkdirSync(stubPkg, { recursive: true });
            for (const file of ['package.json', 'tree-sitter.js']) {
                fs.copyFileSync(path.join(realPkg, file), path.join(stubPkg, file));
            }

            const script = `
                const core = require('./dist');
                core.loadCodeCapabilityGrammars().then(() => {
                    const result = core.analyzeCodeCapabilities('a.ts', "import { exec } from 'child_process'; exec(x);");
                    console.log(JSON.stringify({ settled: true, analysis: result === undefined ? 'fallback' : 'tree' }));
                });
            `;
            const stdout = execFileSync(process.execPath, ['-e', script], {
                cwd: tmp,
                // Other core dependencies resolve from core's node_modules; the
                // stub earlier on the path shadows the real web-tree-sitter.
                env: { ...process.env, NODE_PATH: [path.join(CORE_ROOT, 'node_modules'), path.resolve(CORE_ROOT, '..', '..', 'node_modules')].join(path.delimiter) },
                timeout: 20_000,
                encoding: 'utf8',
            });

            expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual({ settled: true, analysis: 'fallback' });
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
});
