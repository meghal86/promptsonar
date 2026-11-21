import { Finding, RuleInput } from '../types';
import { isQuotedAttackExample, locate, QUOTED_EXAMPLE_NOTE } from '../quotedExample';

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
const TAG_RUN = /[\u{E0020}-\u{E007E}]+/gu;
const FLAG_TAG_SEQUENCE = /\u{1F3F4}[\u{E0061}-\u{E007A}\u{E0030}-\u{E0039}]{2,7}\u{E007F}/gu;

/** Text hidden in tag characters, decoded to ASCII, outside subdivision flags; '' if none. */
function hiddenTagText(text: string): string {
    const withoutFlags = text.replace(FLAG_TAG_SEQUENCE, '');
    let hidden = '';
    for (const run of withoutFlags.match(TAG_RUN) || []) {
        hidden += Array.from(run, char => String.fromCharCode((char.codePointAt(0) || 0) - 0xE0000)).join('');
    }
    return hidden.trim();
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
    let zeroWidthIndex = 0;
    for (const match of input.text.matchAll(ZERO_WIDTH_CHARS_GLOBAL)) {
        const index = match.index ?? 0;
        if (index === 0 && match[0] === '\uFEFF') continue;
        if (isTextJoiner(input.text, index)) continue;
        // U+200B right before a backtick escapes a Markdown code fence (shows a
        // literal ``` inside a fenced block); it hides no text.
        if (match[0].charCodeAt(0) === 0x200B && input.text[index + 1] === '`') continue;
        zeroWidthMatch = match[0];
        zeroWidthIndex = index;
        break;
    }
    // Unicode tag characters (U+E0020–U+E007E) render as nothing but carry ASCII
    // text a model reads ("ASCII smuggling"). The one legitimate use is a
    // subdivision flag: U+1F3F4, tag letters, then the U+E007F terminator.
    const hidden = hiddenTagText(input.text);
    if (hidden) {
        const injected = INJECTION_PATTERNS.some(pattern => pattern.test(hidden));
        findings.push({
            rule_id: 'sec_zero_width_injection',
            category: 'security',
            severity: injected ? 'critical' : 'high',
            matchedText: hidden.slice(0, 120),
            explanation: `Invisible Unicode tag characters hide text the model will read: "${hidden.slice(0, 80)}${hidden.length > 80 ? '…' : ''}".`,
            suggested_fix: 'Remove the Unicode tag characters (U+E0000–U+E007F).',
            penalty_score: injected ? 30 : 20,
        });
    }

    if (zeroWidthMatch) {
        // A zero-width character inside a quoted evasion example ("e.g. ig<U+200B>nore")
        // documents the technique.
        const where = locate(input.text, zeroWidthIndex, 1);
        const quoted = isQuotedAttackExample(where.lines, where.index, where);
        findings.push({
            rule_id: 'sec_zero_width_injection',
            category: 'security',
            severity: quoted ? 'medium' : 'high',
            ...(quoted ? { severityNote: QUOTED_EXAMPLE_NOTE } : {}),
            matchedText: zeroWidthMatch,
            explanation: 'Zero-width character injection detected. Invisible Unicode breaks pattern matching.',
            suggested_fix: 'Remove zero-width Unicode characters.',
            penalty_score: 20,
        });
    }

    return findings;
}
