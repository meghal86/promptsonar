export type FindingConfidence = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

/**
 * How sure we are that a finding is real, derived only from how the rule
 * detects it.
 *
 * This deliberately takes no severity. Severity answers "how bad would this be
 * if true?"; confidence answers "how certain are we that it is true?". They are
 * independent: a critical-severity finding produced by a keyword match is still
 * only as reliable as that keyword match.
 *
 * - HIGH: exact-signature detectors (specific characters, encodings, credential
 *   formats, structural MCP config checks).
 * - LOW: findings inferred from the *absence* of text in a prompt.
 * - MEDIUM: everything else — phrase and keyword detections.
 *
 * VERY_HIGH is intentionally not produced from rule evidence alone.
 */
export function findingConfidence(
    ruleId: string,
    evidenceKind: 'direct' | 'absence' = 'direct',
): FindingConfidence {
    if (
        ruleId === 'sec_base64_encoded_payload' ||
        ruleId === 'sec_zero_width_injection' ||
        ruleId === 'sec_homoglyph_evasion' ||
        ruleId.startsWith('sec_owasp_llm02') ||
        ruleId.startsWith('MCP-')
    ) return 'HIGH';
    if (evidenceKind === 'absence') return 'LOW';
    return 'MEDIUM';
}
