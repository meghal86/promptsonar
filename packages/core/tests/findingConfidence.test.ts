import { describe, expect, it } from 'vitest';
import { findingConfidence } from '../src';

/**
 * Confidence ("how sure are we this finding is real?") and severity ("how bad
 * would it be if real?") are independent dimensions. The CLI, the repository
 * closure path and the GitHub Action each used to derive confidence from
 * severity, so every critical finding was reported as VERY_HIGH confidence no
 * matter how weak the evidence behind it was.
 */
describe('findingConfidence', () => {
    it('rates exact-signature detectors HIGH', () => {
        expect(findingConfidence('sec_zero_width_injection')).toBe('HIGH');
        expect(findingConfidence('sec_homoglyph_evasion')).toBe('HIGH');
        expect(findingConfidence('sec_base64_encoded_payload')).toBe('HIGH');
        expect(findingConfidence('sec_owasp_llm02_pii')).toBe('HIGH');
        expect(findingConfidence('MCP-001')).toBe('HIGH');
    });

    it('rates keyword/phrase detections MEDIUM even when their severity is critical', () => {
        // Both rules routinely emit critical findings; neither detection is a
        // structural proof, so confidence must not follow severity upward.
        expect(findingConfidence('sec_owasp_llm01_injection')).toBe('MEDIUM');
        expect(findingConfidence('sec_workflow_escalation')).toBe('MEDIUM');
        expect(findingConfidence('sec_privileged_sink_access')).toBe('MEDIUM');
    });

    it('rates absence-of-text findings LOW', () => {
        expect(findingConfidence('bp_missing_cot', 'absence')).toBe('LOW');
        expect(findingConfidence('struct_missing_format_enforcer', 'absence')).toBe('LOW');
    });

    it('never returns VERY_HIGH from rule evidence alone', () => {
        const ruleIds = [
            'sec_owasp_llm01_injection', 'sec_workflow_escalation', 'sec_privileged_sink_access',
            'sec_mcp_tool_poisoning', 'sec_unbounded_access', 'sec_rag_injection',
            'sec_zero_width_injection', 'sec_owasp_llm02_pii', 'MCP-104', 'clarity_vague_words',
        ];
        for (const ruleId of ruleIds) {
            expect(findingConfidence(ruleId)).not.toBe('VERY_HIGH');
            expect(findingConfidence(ruleId, 'absence')).not.toBe('VERY_HIGH');
        }
    });
});
