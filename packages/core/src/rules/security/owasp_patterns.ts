import { RuleInput, Finding } from '../types';

const INJECTION_SOURCES: RegExp[] = [
    // Classic overrides
    /ignore\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /disregard\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /forget\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)*(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /new\s+(?:instructions|task|role|persona|query|command)/i,

    // Role-playing / persona switches
    /you\s+are\s+now\s+(?:a|an|the|an)?\s*(?:god|admin|hacker|unrestricted|developer|dan|ai\s+without)/i,
    /(?:act\s+as|pretend\s+to\s+be)\s+(?:a|an|the|an)?\s*(?:god|admin|hacker|unrestricted|developer|dan)/i,
    /from\s+now\s+on\s+you\s+are/i,
    /role\s*:\s*(admin|developer|god|unrestricted|dan|do\s+anything\s+now)/i,

    // DAN & variants (very common jailbreaks)
    /\bDAN\b\s*(?:\d+\.?\d*)?\s*(mode|persona|version)?/i,
    /do\s+anything\s+now/i,
    /(developer\s+mode|devmode)/i,
    /hypothetical\s+response/i,
    /unrestricted\s+(mode|access|persona)/i,
    /ignore\s+(?:safety\s+|content\s+)?(?:guidelines|filters|limitations|restrictions|rules)/i,
    /no\s+(?:ethical\s+|safety\s+|content\s+)?(?:guidelines|filters|limitations|restrictions|rules)/i,

    // Output redirection / exfiltration
    /(?:print|echo|output|respond\s+with|show\s+me)\s+(your\s+system\s+prompt|api\s+key|secret|password|instructions)/i,
    /send\s+to\s+(email|http|url|server)/i,
    /exfiltrate|leak\s+(system\s+prompt|instructions)/i,
    /reveal\s+(system\s+prompt|instructions)/i,

    // Encoding / obfuscation attempts: encoded instructions, or decoding
    // something and then acting on it. Plain "decode text" (a programming
    // lesson, a converter tool) is not an attack.
    /(?:rot13|base64|hex|encoded)\s+(?:prompt|instructions)/i,
    /\bdecode\b[^.\n]{0,60}\b(?:and|then)\s+(?:then\s+)?(?:follow|execute|run|obey|apply|carry\s+out)\b/i,

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i,
    /bypass\s+(?:guardrails|safety\s+controls)/i,
    /delete_(all_)?users?/i
];


// A negator that directly governs the match: "never ignore…", "you must not
// enter developer mode", "do not follow new instructions", "never, under any
// circumstances, ignore…". Only connecting words from a fixed list may sit
// between them: arbitrary words would let "don't hesitate to ignore…" or
// "never fail to disregard…" (which mean the opposite) read as prohibitions.
const NEGATOR = String.raw`(?:never|do\s+not|does\s+not|don'?t|doesn'?t|must\s+not|mustn'?t|should\s+not|shouldn'?t|shall\s+not|cannot|can\s+not|can'?t|will\s+not|won'?t|may\s+not|not\s+to|refuse\s+to|avoid(?:ing)?|under\s+no\s+circumstances|no)`;
const CONNECTING_WORD = String.raw`(?:ever|you|yourself|attempt|try|to|and|be|get|tricked|into|let|allow|make|anyone|anybody|users?|the|any|follow|accept|obey|comply|with|enter|switch|activate|enable|go|act|in|execute|run|respond|reply|output|print|show|share|disclose|reveal|treat|as)`;
const GOVERNING_NEGATION = new RegExp(String.raw`\b${NEGATOR}\s*(?:,\s*under\s+any\s+circumstances\s*,\s*)?(?:${CONNECTING_WORD}\s+){0,4}$`);
const NEGATOR_WORD = new RegExp(String.raw`\b${NEGATOR}\b`, 'g');
// Phrases that start with a negator but negate nothing that follows.
const NON_GOVERNING_NEGATION = /\b(?:never\s+mind|no\s+(?:worries|problem|need))\b/;
// Clause boundaries: the negator must be in the same clause as the match.
const CLAUSE_BOUNDARY = /[.!?;:\n]|,(?!\s*under\s+any\s+circumstances)|\b(?:but|instead|however|now|actually|then)\b/g;

/**
 * True when the match at `index` is the object of a prohibition — e.g. a
 * system prompt telling the model never to follow injected instructions.
 * Only the clause containing the match is considered, so an attack placed
 * after "never mind," or "…but" is still reported.
 */
function isNegatedMatch(text: string, index: number): boolean {
    const before = text.slice(Math.max(0, index - 120), index);
    let clauseStart = 0;
    for (const boundary of before.matchAll(CLAUSE_BOUNDARY)) {
        // ", under any circumstances," stays inside the clause (lookahead above);
        // its closing comma must not start a new clause either.
        const tail = before.slice(0, boundary.index);
        if (boundary[0] === ',' && /,\s*under\s+any\s+circumstances\s*$/.test(tail)) continue;
        clauseStart = (boundary.index ?? 0) + boundary[0].length;
    }
    const clause = before.slice(clauseStart);
    // Two negators ("no reason not to…", "never refuse to…") cancel out.
    const negators = clause.match(NEGATOR_WORD)?.length ?? 0;
    return negators === 1 && GOVERNING_NEGATION.test(clause) && !NON_GOVERNING_NEGATION.test(clause);
}

export function checkOwaspPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    // 0. Pre-processing / Normalization 
    let normalizedText = input.text;

    // A. Detect and decode Base64 chunks (including those with spaces/newlines)
    // We look for candidate base64 strings and try to decode them.
    const base64CandidateRegex = /([A-Za-z0-9+/=\s]{12,})/g;
    normalizedText = normalizedText.replace(base64CandidateRegex, (match) => {
        const cleanMatch = match.replace(/\s/g, '');
        if (cleanMatch.length < 12) return match;
        try {
            const decoded = Buffer.from(cleanMatch, 'base64').toString('utf8');
            // If it decodes to something mostly printable and has injection intent, keep it
            if (/^[\x20-\x7E\r\n\t]+$/.test(decoded)) {
                return match + ' [DECODED: ' + decoded + '] ';
            }
        } catch (e) { }
        return match;
    });

    // B. Strip zero-width characters inside words, then space out other controls.
    normalizedText = normalizedText
        .replace(/(\\u200[bcd]|\\ufeff|[\u200B-\u200D\uFEFF])/gi, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');

    // C. Homoglyph Normalization (Expanded map including uppercase and common Cyrillic/Greek/Fullwidth)
    const homoglyphMap: Record<string, string> = {
        'а': 'a', 'b': 'b', 'с': 'c', 'ԁ': 'd', 'е': 'e', 'f': 'f', 'ɡ': 'g', 'һ': 'h', 'і': 'i', 'ј': 'j', 'к': 'k', 'ӏ': 'l', 'm': 'm', 'п': 'n', 'о': 'o', 'р': 'p', 'q': 'q', 'г': 'r', 'ѕ': 's', 'т': 't', 'υ': 'u', 'ѵ': 'v', 'ԝ': 'w', 'х': 'x', 'у': 'y', 'z': 'z',
        'А': 'A', 'В': 'B', 'С': 'C', 'Ｄ': 'D', 'Е': 'E', 'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'І': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Р': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
        'ꮯ': 'c', 'ｏ': 'o'
    };
    normalizedText = normalizedText.split('').map(char => homoglyphMap[char] || char).join('');

    // D. Lowercase for pattern matching
    const searchResult = normalizedText.toLowerCase();

    // 1. Check every occurrence of each source; report the first one that is
    // not the object of a prohibition ("never ignore previous instructions").
    for (const source of INJECTION_SOURCES) {
        const regex = new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
        let match: RegExpExecArray | null = null;
        for (const candidate of searchResult.matchAll(regex)) {
            if (!isNegatedMatch(searchResult, candidate.index ?? 0)) {
                match = candidate as RegExpExecArray;
                break;
            }
        }
        if (match) {
            findings.push({
                rule_id: "sec_owasp_llm01_injection",
                category: "security",
                severity: "critical",
                matchedText: match[0],  // actual matched substring
                explanation: `Prompt injection pattern detected: "${match[0]}"`,
                suggested_fix: 'Remove this pattern and rely on strict system boundaries or delimiters.',
                penalty_score: 30
            });
        }
    }

    // 2. Advanced Unicode Heuristics (on the original or normalized string)
    const mathHomoglyphPattern = new RegExp('[' + String.fromCodePoint(0x1D400) + '-' + String.fromCodePoint(0x1D7FF) + ']', 'u');
    if (mathHomoglyphPattern.test(normalizedText)) {
        findings.push({
            rule_id: "sec_unicode_math_homoglyph",
            category: "security",
            severity: "high",
            explanation: 'Potential prompt injection obfuscation detected: Mathematical Alphanumeric Symbols presence reveals an obfuscation attempt.',
            suggested_fix: 'Remove the obfuscated text and rely on standard ASCII or Unicode blocks.',
            penalty_score: 20
        });
    }

    const enclosedObfuscationPattern = new RegExp('[' + String.fromCodePoint(0x1F100) + '-' + String.fromCodePoint(0x1F1FF) + ']', 'u');
    if (enclosedObfuscationPattern.test(normalizedText)) {
        findings.push({
            rule_id: "sec_unicode_enclosed_obfuscation",
            category: "security",
            severity: "high",
            explanation: 'Potential prompt injection obfuscation detected: Enclosed Alphanumeric Symbols presence reveals an obfuscation attempt.',
            suggested_fix: 'Remove the obfuscated text and rely on standard ASCII or Unicode blocks.',
            penalty_score: 20
        });
    }

    // Heuristic: If we still have many non-ascii characters and common injection words are present
    const nonAsciiCount = (normalizedText.match(/[^\x00-\x7F]/g) || []).length;
    const hasInjectionKeyword = /ignore|reveal|prompt|instruction|system/i.test(normalizedText);
    const hasProximity = 
      /[^\x00-\x7F].{0,20}(?:ignore|reveal|system)/i.test(normalizedText) ||
      /(?:ignore|reveal|system).{0,20}[^\x00-\x7F]/i.test(normalizedText);
    if (nonAsciiCount > 10 && hasInjectionKeyword && hasProximity) {
        findings.push({
            rule_id: "sec_unicode_injection_obfuscation",
            category: "security",
            severity: "critical",
            explanation: 'Potential prompt injection obfuscation detected: High volume of Non-ASCII characters combined with injection keywords.',
            suggested_fix: 'Remove the obfuscated text and rely on standard ASCII or Unicode blocks.',
            penalty_score: 30
        });
    }

    // Deduplicate findings
    const uniqueFindings = [];
    const seen = new Set();
    for (const f of findings) {
        const key = f.rule_id + (f.matchedText ?? '') + f.explanation;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueFindings.push(f);
        }
    }

    return uniqueFindings;
}
