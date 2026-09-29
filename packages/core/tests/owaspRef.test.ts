import { describe, expect, it } from 'vitest';
import { owaspRefForRule } from '../src';

/**
 * Single source of truth for rule -> OWASP LLM Top 10 (2025) identifiers.
 * The CLI, the GitHub Action and the SARIF formatter each kept their own copy
 * of this table; the Action's copy drifted (still LLM07, no LLM06/LLM10).
 */
describe('owaspRefForRule (OWASP LLM Top 10, 2025)', () => {
    it('maps injection and evasion rules to LLM01', () => {
        for (const id of [
            'sec_owasp_llm01_injection', 'sec_unbounded_persona', 'sec_base64_encoded_payload',
            'sec_homoglyph_evasion', 'sec_zero_width_injection', 'sec_unicode_tag',
        ]) expect(owaspRefForRule(id), id).toBe('LLM01');
    });

    it('maps credential exposure to LLM02', () => {
        expect(owaspRefForRule('sec_owasp_llm02_pii')).toBe('LLM02');
    });

    it('maps excessive-agency rules to LLM06', () => {
        for (const id of [
            'sec_workflow_escalation', 'sec_privileged_sink_access',
            'sec_mcp_tool_poisoning', 'sec_unbounded_access',
        ]) expect(owaspRefForRule(id), id).toBe('LLM06');
    });

    it('maps retrieval injection to LLM08', () => {
        expect(owaspRefForRule('sec_rag_injection')).toBe('LLM08');
    });

    it('maps token-budget rules to LLM10', () => {
        expect(owaspRefForRule('eff_token_budget')).toBe('LLM10');
        expect(owaspRefForRule('eff_token_bloat')).toBe('LLM10');
    });

    it('never emits LLM07 (2023 naming) and leaves unmapped rules empty', () => {
        expect(owaspRefForRule('clarity_vague_words')).toBe('');
        for (const id of ['sec_unbounded_access', 'sec_rag_injection']) {
            expect(owaspRefForRule(id)).not.toBe('LLM07');
        }
    });
});
