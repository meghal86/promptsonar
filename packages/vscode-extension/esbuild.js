const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',
    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd((result) => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

const mainConfig = {
    entryPoints: ["./src/client/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/client/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin]
};

const serverConfig = {
    entryPoints: ["./src/server/server.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/server/server.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin]
};

async function copyAssets() {
    console.log("[build] Copying WASM and SCM assets...");
    const distDir = path.join(__dirname, "dist");
    const coreRoot = path.join(__dirname, "..", "core");

    // Ensure dist exists
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }

    // 1. Copy web-tree-sitter WASM
    const treeSitterWasmSrc = path.join(coreRoot, "node_modules", "web-tree-sitter", "tree-sitter.wasm");
    if (fs.existsSync(treeSitterWasmSrc)) {
        fs.copyFileSync(treeSitterWasmSrc, path.join(distDir, "tree-sitter.wasm"));
    }

    // 2. Copy language WASMs
    const wasmsDirSrc = path.join(coreRoot, "node_modules", "tree-sitter-wasms", "out");
    if (fs.existsSync(wasmsDirSrc)) {
        const destWasms = path.join(distDir, "tree-sitter-wasms", "out");
        if (!fs.existsSync(destWasms)) fs.mkdirSync(destWasms, { recursive: true });

        fs.readdirSync(wasmsDirSrc).filter(f => f.endsWith('.wasm')).forEach(file => {
            fs.copyFileSync(path.join(wasmsDirSrc, file), path.join(destWasms, file));
        });
    }

    // 3. Copy queries (.scm files)
    const queriesSrc = path.join(coreRoot, "queries");
    if (fs.existsSync(queriesSrc)) {
        const destQueries = path.join(distDir, "queries");
        if (!fs.existsSync(destQueries)) fs.mkdirSync(destQueries, { recursive: true });

        fs.readdirSync(queriesSrc).filter(f => f.endsWith('.scm')).forEach(file => {
            fs.copyFileSync(path.join(queriesSrc, file), path.join(destQueries, file));
        });
    }
}

async function build() {
    if (watch) {
        const clientCtx = await esbuild.context(mainConfig);
        const serverCtx = await esbuild.context(serverConfig);
        await copyAssets();
        await clientCtx.watch();
        await serverCtx.watch();
    } else {
        await esbuild.build(mainConfig);
        await esbuild.build(serverConfig);
        await copyAssets();
    }
}

build().catch(() => process.exit(1));
