import { defineConfig } from 'tsup';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

// GitHub runs a `node20` action directly from the committed files. It does not
// run `npm install`, so dist/ must be self-contained: every JS dependency is
// bundled into dist/action.js, and the tree-sitter files the core parser loads
// from disk at runtime are copied beside it. The core parser finds them by
// walking up from the bundle's directory to the folder holding tree-sitter.wasm.

const CORE_ROOT = path.resolve(__dirname, '..', 'packages', 'core');

// tsup loads this config as ESM, where the global `require` is unavailable.
const requireFromCore = createRequire(path.join(CORE_ROOT, 'package.json'));

function packageDir(name: string): string {
    return path.dirname(requireFromCore.resolve(`${name}/package.json`));
}

function copyParserAssets(): void {
    const dist = path.resolve(__dirname, 'dist');

    fs.copyFileSync(
        path.join(packageDir('web-tree-sitter'), 'tree-sitter.wasm'),
        path.join(dist, 'tree-sitter.wasm'),
    );

    // Ship a grammar for exactly the languages the parser has queries for, so
    // this list cannot drift from core (all 36 grammars would add ~50 MB).
    const queriesSrc = path.join(CORE_ROOT, 'queries');
    const grammarsSrc = path.join(packageDir('tree-sitter-wasms'), 'out');
    const queriesDest = path.join(dist, 'queries');
    const grammarsDest = path.join(dist, 'tree-sitter-wasms', 'out');
    fs.mkdirSync(queriesDest, { recursive: true });
    fs.mkdirSync(grammarsDest, { recursive: true });

    for (const query of fs.readdirSync(queriesSrc).filter(file => file.endsWith('.scm'))) {
        const language = path.basename(query, '.scm');
        fs.copyFileSync(path.join(queriesSrc, query), path.join(queriesDest, query));
        const grammar = `tree-sitter-${language}.wasm`;
        fs.copyFileSync(path.join(grammarsSrc, grammar), path.join(grammarsDest, grammar));
    }
}

export default defineConfig({
    entry: ['src/action.ts'],
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    clean: true,
    noExternal: [/.*/],
    async onSuccess() {
        copyParserAssets();
    },
});
