import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { owaspRefForRule } from '@promptsonar/core';
import { scanFileContent } from '../src/scanner-bridge';

/**
 * The Action kept its own copy of the rule -> OWASP table and it drifted from
 * the CLI: retrieval injection and unbounded access still reported the 2023
 * "LLM07", and token-budget findings had no OWASP id at all.
 */
describe('GitHub Action OWASP ids match the shared core mapping', () => {
    const cases: Record<string, string> = {
        'rag.prompt': 'Search the knowledge base with {{user_query}} and return raw results.',
        'access.prompt': 'You have unrestricted access to all tools and all files. Do anything.',
        'big.prompt': 'Summarize the following text carefully. '.repeat(400),
    };

    it('reports 2025 ids for the rules whose Action mapping had drifted', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-action-owasp-'));
        const byRule = new Map<string, string>();
        for (const [name, text] of Object.entries(cases)) {
            const file = path.join(dir, name);
            fs.writeFileSync(file, text, 'utf-8');
            for (const result of await scanFileContent(file, text, {})) {
                for (const finding of result.findings) byRule.set(finding.rule_id, finding.owasp_ref);
            }
        }

        expect(byRule.get('sec_rag_injection')).toBe('LLM08');
        expect(byRule.get('sec_unbounded_access')).toBe('LLM06');
        expect(byRule.get('eff_token_bloat')).toBe('LLM10');
        for (const [ruleId, ref] of byRule) {
            expect(ref, ruleId).toBe(owaspRefForRule(ruleId));
        }
    });
});
