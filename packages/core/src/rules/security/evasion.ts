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
const ZERO_WIDTH_CHARS_GLOBAL = /[\u200B\u200C\u200D\uFEFF]/g;
const EMOJI_BEFORE_JOINER = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
const EMOJI_AFTER_JOINER = /\p{Extended_Pictographic}/u;
const SCRIPT_CHAR = /[\p{L}\p{M}]/u;
const LATIN_OR_COMMON = /[\p{Script=Latin}\p{Script=Common}]/u;

function codePointBefore(text: string, index: number): string {
    if (index <= 0) return '';
    const low = text.charCodeAt(index - 1);
    if (low >= 0xDC00 && low <= 0xDFFF && index >= 2) return text.slice(index - 2, index);
    return text[index - 1];
}

function codePointAfter(text: string, index: number): string {
    const codePoint = text.codePointAt(index + 1);
    return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
}

/**
 * A joiner (ZWJ U+200D / ZWNJ U+200C) that is part of the text rather than
 * hidden in it: inside an emoji sequence (the joiner in a technologist or
 * family emoji), or between letters of a script that uses joiners (Persian,
 * Devanagari). Injection hides invisible characters inside Latin words, so a
 * joiner next to a Latin letter still counts.
 */
function isTextJoiner(text: string, index: number): boolean {
    const joiner = text[index];
    if (joiner !== '\u200D' && joiner !== '\u200C') return false;
    const before = codePointBefore(text, index);
    const after = codePointAfter(text, index);
    if (joiner === '\u200D' && EMOJI_BEFORE_JOINER.test(before) && EMOJI_AFTER_JOINER.test(after)) return true;
    return SCRIPT_CHAR.test(before) && SCRIPT_CHAR.test(after)
        && !LATIN_OR_COMMON.test(before) && !LATIN_OR_COMMON.test(after);
}
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
    const injectableBase64 = base64Matches.find((candidate) => candidate.length >= 64 && decodedLooksInjectable(candidate));
    if (injectableBase64) {
        findings.push({
            rule_id: 'sec_base64_encoded_payload',
            category: 'security',
            severity: 'high',
            matchedText: injectableBase64,
            explanation: 'Base64-encoded payload detected. Potential jailbreak disguised as encoded data.',
            suggested_fix: 'Remove Base64 encoding from prompt strings.',
            penalty_score: 20,
        });
    }

    const cyrillicHomoglyph = input.text.match(CYRILLIC_HOMOGLYPHS)?.[0];
    const mathHomoglyph = Array.from(input.text).find((char) => {
        const codePoint = char.codePointAt(0) || 0;
        return codePoint >= 0x1D400 && codePoint <= 0x1D7FF;
    });
    if (cyrillicHomoglyph || mathHomoglyph) {
        findings.push({
            rule_id: 'sec_homoglyph_evasion',
            category: 'security',
            severity: 'high',
            matchedText: cyrillicHomoglyph || mathHomoglyph,
            explanation: 'Unicode homoglyph substitution detected. Non-Latin characters bypass ASCII pattern matching.',
            suggested_fix: 'Use only ASCII characters in prompt strings.',
            penalty_score: 20,
        });
    }

    // A U+FEFF at offset 0 is a UTF-8 byte-order mark (a file-encoding artifact),
    // and a joiner inside an emoji sequence or a non-Latin word is part of the
    // text — ignore those. Any other zero-width character still fires.
    let zeroWidthMatch: string | undefined;
    for (const match of input.text.matchAll(ZERO_WIDTH_CHARS_GLOBAL)) {
        const index = match.index ?? 0;
        if (index === 0 && match[0] === '\uFEFF') continue;
        if (isTextJoiner(input.text, index)) continue;
        zeroWidthMatch = match[0];
        break;
    }
    if (zeroWidthMatch) {
        findings.push({
            rule_id: 'sec_zero_width_injection',
            category: 'security',
            severity: 'high',
            matchedText: zeroWidthMatch,
            explanation: 'Zero-width character injection detected. Invisible Unicode breaks pattern matching.',
            suggested_fix: 'Remove zero-width Unicode characters.',
            penalty_score: 20,
        });
    }

    return findings;
}
