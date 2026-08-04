import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

describe('VS Code manifest commands', () => {
    it('exposes execution-path workbench commands', () => {
        const commands = manifest.contributes.commands.map((command) => command.command);

        expect(commands).toContain('promptsonar.scanCurrentFile');
        expect(commands).toContain('promptsonar.openExecutionPath');
        expect(commands).toContain('promptsonar.showWorkflowDiff');
        expect(commands).toContain('promptsonar.applyFixAndShowWorkflowDiff');
        expect(commands).toContain('promptsonar.exportSarif');
        expect(commands).toContain('promptsonar.copyReport');
        expect(commands).toContain('promptsonar.copyExecutionPath');
        expect(commands).toContain('promptsonar.openPlayground');
    });

    it('depends on the workflow-aware core package', () => {
        expect(manifest.dependencies['@promptsonar/core']).toBe('^1.5.0');
    });
});
