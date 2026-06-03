import { describe, expect, it } from 'vitest';
import { isPromptSonarIgnoredPath, parsePromptSonarIgnore } from '../src/shared/ignore';

describe('PromptSonar ignore matching', () => {
    const root = '/repo';
    const matcher = parsePromptSonarIgnore(`
# generated fixtures
examples/**
README.md
PromptSonar_*.md
packages/cli/src/cli.ts
packages/cli/src/scanner.ts
action/src/scanner-bridge.ts
scripts/run-feature-smoke.js
packages/core/src/workflow/**
/generated-root-only.json
vendor/*
!vendor/keep.prompt
`, root);
    const matchers = [matcher];

    it('matches exact repository-relative paths', () => {
        expect(isPromptSonarIgnoredPath('/repo/packages/cli/src/cli.ts', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/packages/cli/src/scanner.ts', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/action/src/scanner-bridge.ts', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/scripts/run-feature-smoke.js', matchers)).toBe(true);
    });

    it('matches directory globs', () => {
        expect(isPromptSonarIgnoredPath('/repo/examples/cases/basic.prompt', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/packages/core/src/workflow/engine.ts', matchers)).toBe(true);
    });

    it('matches basename globs without excluding unrelated source files', () => {
        expect(isPromptSonarIgnoredPath('/repo/docs/README.md', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/PromptSonar_Report.md', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/packages/core/src/rules/index.ts', matchers)).toBe(false);
        expect(isPromptSonarIgnoredPath('/outside/packages/cli/src/cli.ts', matchers)).toBe(false);
    });

    it('supports standard gitignore rooted paths, directory rules, and negation', () => {
        expect(isPromptSonarIgnoredPath('/repo/generated-root-only.json', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/nested/generated-root-only.json', matchers)).toBe(false);
        expect(isPromptSonarIgnoredPath('/repo/vendor/generated.prompt', matchers)).toBe(true);
        expect(isPromptSonarIgnoredPath('/repo/vendor/keep.prompt', matchers)).toBe(false);
    });
});
