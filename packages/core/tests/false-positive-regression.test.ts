import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { checkPii, scanContentForSecrets } from '../src/rules/security/pii';
import { checkEvasionPatterns } from '../src/rules/security/evasion';

// Regression for two rules responsible for the bulk of false positives found in
// the wild-corpus audit:
//  - sec_owasp_llm02_pii fired on type annotations, env-var reads, imports,
//    docstrings, doc placeholders, "max_tokens", and fake test keys.
//  - sec_zero_width_injection fired on a leading UTF-8 BOM (U+FEFF at offset 0).
// Fixtures are real reductions of the audited false positives.
//
// These call the rule functions directly (not the repo pipeline) because a plain
// .md/.cs is not always parsed as a prompt by discovery — the rules are the unit
// under change, so this is the precise, deterministic check.

const DIR = path.resolve(__dirname, '../test/fixtures/false-positive-regression');
const read = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8');

function piiCount(name: string): number {
    const text = read(name);
    const filePath = path.join(DIR, name);
    const fromPrompt = checkPii({ text, context: { filePath } } as any)
        .filter(f => f.rule_id === 'sec_owasp_llm02_pii').length;
    const fromContent = scanContentForSecrets(text, filePath).length;
    return fromPrompt + fromContent;
}

function zeroWidthCount(name: string): number {
    const text = read(name);
    return checkEvasionPatterns({ text, context: { filePath: path.join(DIR, name) } } as any)
        .filter(f => f.rule_id === 'sec_zero_width_injection').length;
}

describe('false-positive regression (sec_owasp_llm02_pii + sec_zero_width_injection)', () => {
    it('does not flag a type annotation + env-var read', () => {
        expect(piiCount('env-var-read.ts')).toBe(0);
    });

    it('does not flag an import of a class named Secret', () => {
        expect(piiCount('secret-import.ts')).toBe(0);
    });

    it('does not flag "max_tokens" (substring "token")', () => {
        expect(piiCount('max-tokens.ts')).toBe(0);
    });

    it('does not flag a documentation placeholder value', () => {
        expect(piiCount('doc-placeholder.md')).toBe(0);
    });

    it('does not flag a fake key in a *.test.ts fixture', () => {
        expect(piiCount('fake-test-key.test.ts')).toBe(0);
    });

    it('STILL flags a real hardcoded provider secret', () => {
        expect(piiCount('real-hardcoded-secret.ts')).toBeGreaterThanOrEqual(1);
    });

    it('does not flag a leading UTF-8 BOM as zero-width injection', () => {
        expect(zeroWidthCount('bom-file.cs')).toBe(0);
    });

    it('STILL flags a genuine zero-width space (U+200B) mid-content', () => {
        expect(zeroWidthCount('zero-width-not-bom.md')).toBeGreaterThanOrEqual(1);
    });
});
