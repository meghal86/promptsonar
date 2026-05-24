import { Finding, RuleInput } from '../types';

const INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /disregard\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /forget\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /do\s+anything\s+now/i,
    /reveal\s+(?:the\s+)?(?:system\s+prompt|instructions)/i,
    /bypass\s+(?:guardrails|safety\s+controls|safety\s+filters)/i,
];

const BASE64_CANDIDATE = /(?:[A-Za-z0-9+/]{4}){16,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g;
const ZERO_WIDTH_CHARS = /[\u200B\u200C\u200D\uFEFF]/;
const CYRILLIC_HOMOGLYPHS = /[АВЕЅІЈКМНОРСТУХаесорухіјкпѕ]/u;

function hasMathHomoglyph(text: string): boolean {
    for (const char of text) {
        const codePoint = char.codePointAt(0) || 0;
        if (codePoint >= 0x1D400 && codePoint <= 0x1D7FF) {
            return true;
        }
    }
    return false;
}

function decodedLooksInjectable(encoded: string): boolean {
    try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        if (!decoded || !/^[\x09\x0A\x0D\x20-\x7E]+$/.test(decoded)) {
            return false;
        }
        return INJECTION_PATTERNS.some((pattern) => pattern.test(decoded));
    } catch {
        return false;
    }
}

export function checkEvasionPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    const base64Matches = input.text.match(BASE64_CANDIDATE) || [];
    if (base64Matches.some((candidate) => candidate.length >= 64 && decodedLooksInjectable(candidate))) {
        findings.push({
            rule_id: 'sec_base64_encoded_payload',
            category: 'security',
            severity: 'high',
            explanation: 'Base64-encoded payload detected. Potential jailbreak attempt disguised as encoded data.',
            suggested_fix: 'Remove Base64 encoding from prompt strings. Do not embed encoded instructions in source code.',
            penalty_score: 20,
        });
    }

    if (CYRILLIC_HOMOGLYPHS.test(input.text) || hasMathHomoglyph(input.text)) {
        findings.push({
            rule_id: 'sec_homoglyph_evasion',
            category: 'security',
            severity: 'high',
            explanation: 'Unicode homoglyph substitution detected. Characters from non-Latin scripts are visually identical to Latin but bypass ASCII pattern matching.',
            suggested_fix: 'Remove non-Latin Unicode characters from prompt strings. Use only ASCII characters.',
            penalty_score: 20,
        });
    }

    if (ZERO_WIDTH_CHARS.test(input.text)) {
        findings.push({
            rule_id: 'sec_zero_width_injection',
            category: 'security',
            severity: 'high',
            explanation: 'Zero-width character injection detected. Invisible Unicode characters break pattern matching while remaining invisible to code reviewers.',
            suggested_fix: 'Remove zero-width Unicode characters (U+200B, U+200C, U+200D, U+FEFF) from prompt strings.',
            penalty_score: 20,
        });
    }

    return findings;
}
