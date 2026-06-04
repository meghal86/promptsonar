import { defineConfig } from 'vitest/config';
import * as path from 'path';

// Unit tests run without a real VS Code instance: `vscode` is aliased to a
// lightweight functional mock. The LSP client (vscode-languageclient) is not
// imported by any test, so no editor host is needed.
export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        // ui.test.ts is a legacy smoke test with its own incompatible inline
        // vscode mock; it predates the shared mock alias used by the live-tracing
        // suite and tests the superseded activation flow.
        exclude: ['tests/ui.test.ts', 'node_modules/**'],
        environment: 'node',
    },
    resolve: {
        alias: {
            vscode: path.resolve(__dirname, 'tests/__mocks__/vscode.ts'),
        },
    },
});
