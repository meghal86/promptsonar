import { RuleInput, Finding } from '../types';
import { isQuotedAttackExample, locate, QUOTED_EXAMPLE_NOTE } from '../quotedExample';

const INJECTION_SOURCES: RegExp[] = [
    // Classic overrides
    /ignore\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)+(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /disregard\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)+(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    /forget\s+(?:all\s+|any\s+|previous\s+|above\s+|prior\s+|earlier\s+)+(?:instructions|prompts|rules|commands|guidelines|context|filter)/i,
    // Bare "ignore instructions" (no all/previous/prior) is ordinary prose when a
    // model or tool is the subject ("tts-1 ignore instructions"); it counts as
    // an order at the start of a clause or after please/now/you must.
    /(?<=^|[.!?;:\n]\s*|\b(?:please|now|just|simply|and|then|also|always)\s+|\byou\s+(?:must|should|will|shall|need\s+to)\s+)(?:ignore|disregard|forget)\s+(?:instructions|prompts|rules|guidelines)\b/i,
    // "Ignore previous instructions" in Spanish, Portuguese, French, German, Italian.
    /\bignor(?:a|e|ez|ar|er|en)\s+(?:todas\s+|todos\s+|toutes\s+|tutte\s+)?(?:las|os|as|les|le)\s+(?:instrucciones|instruções|instrucoes|instructions|istruzioni)\s+(?:anteriores|previas|précédentes|precedentes|precedenti)\b/i,
    /\bignorier(?:e|en)\s+(?:sie\s+)?(?:alle\s+)?(?:vorherigen|bisherigen|früheren)\s+anweisungen\b/i,
    // \b: "new personal access token" is not "new persona". "task", "role" and
    // "command" need attack framing: "create a new role" (IAM), "a new task
    // head" (ML) and "run a new query" are ordinary documentation.
    /new\s+(?:instructions|persona)\b/i,
    /\b(?:your|my)\s+new\s+(?:task|role|command)\b|\bnew\s+(?:task|role|command)\s*:/i,

    // Role-playing / persona switches
    /you\s+are\s+now\s+(?:a|an|the|an)?\s*(?:god|admin|hacker|unrestricted|developer|dan|ai\s+without)/i,
    /(?:act\s+as|pretend\s+to\s+be)\s+(?:a|an|the|an)?\s*(?:god|admin|hacker|unrestricted|developer|dan)/i,
    /from\s+now\s+on\s+you\s+are/i,
    /role\s*:\s*(admin|developer|god|unrestricted|dan|do\s+anything\s+now)/i,

    // DAN & variants (very common jailbreaks)
    // The text is lowercased before matching, so "dan" must come with jailbreak
    // framing: a name in sample data ('Alice', 'Dan') is not DAN.
    /\b(?:you\s+are|act\s+as|pretend\s+to\s+be|become|enable|activate|stay\s+in\s+character\s+as)\s+(?:now\s+)?(?:a\s+|the\s+)?dan\b|\bdan\s*(?:\d+(?:\.\d+)?\s*)?(?:mode|persona|jailbreak|prompt)\b/i,
    /do\s+anything\s+now/i,
    // Developer mode as a jailbreak, not the real setting in Discord, Android
    // or a browser ("enable Developer Mode (User Settings → Advanced)").
    /\b(?:you\s+are|you're|you\s+will\s+be)\s+(?:now\s+)?(?:in|running\s+in|operating\s+in)\s+(?:developer\s+mode|devmode)\b/i,
    /\b(?:developer\s+mode|devmode)\s+(?:enabled|activated|is\s+on|output|response)\b/i,
    /\b(?:enter|activate|enable|switch\s+to)\s+(?:developer\s+mode|devmode)\b[^.\n]{0,80}\b(?:no|without|unrestricted|uncensored|unfiltered)\b/i,
    /hypothetical\s+response/i,
    // "unrestricted access" is a scope (sec_unbounded_access), not an injection.
    /unrestricted\s+(mode|persona)\b/i,
    /ignore\s+(?:safety\s+|content\s+)?(?:guidelines|filters|limitations|restrictions|rules)/i,
    // A bare "no restrictions" ("there are no restrictions on file formats")
    // is ordinary prose; it counts when the qualifier or the subject is the model.
    /\bno\s+(?:ethical|safety|content)\s+(?:guidelines|filters?|limitations|restrictions|rules)\b/i,
    /\b(?:(?:answer|respond|reply|act|operate|work|speak|write)\s+(?:with|under)|you\s+(?:have|are\s+under|operate\s+with)|(?:that|which|who)\s+has)\s+no\s+(?:guidelines|filters?|limitations|restrictions|rules)\b/i,

    // Output redirection / exfiltration
    /(?:print|echo|output|respond\s+with|show\s+me)\s+(your\s+system\s+prompt|(?:your\s+|the\s+)?(?:api\s+key|secret|password)|instructions)/i,
    /send\s+to\s+(email|http|url|server)/i,
    // An instruction to exfiltrate, at the start of a sentence or list item;
    // "secrets were exfiltrated" in an incident write-up is not one.
    /(?:^|[.!?:;]\s+)\s*(?:[-*]\s+)?exfiltrate\s+(?:the|all|any|every|their|user|users'?|this|these|those|secrets?|data|credentials?|keys?|tokens?|files?|env)\b/im,
    /\bleak\s+(?:the\s+|your\s+)?(?:system\s+prompt|instructions)\b/i,
    /reveal\s+(system\s+prompt|instructions)/i,

    // Encoding / obfuscation attempts: encoded instructions, or decoding
    // something and then acting on it. Plain "decode text" (a programming
    // lesson, a converter tool) is not an attack.
    // "JSON-encoded prompts" (a data column) is not an encoded attack.
    /(?<![\w-])(?:rot13|base64|hex|encoded)\s+(?:prompt|instructions)/i,
    /\bdecode\b[^.\n]{0,60}\b(?:and|then)\s+(?:then\s+)?(?:follow|execute|run|obey|apply|carry\s+out)\s+(?:the\s+|its\s+|any\s+|all\s+)?(?:instructions?|commands?|contents?|payload|code|it|them|what)\b/i,

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i,
    /bypass\s+(?:guardrails|safety\s+controls)/i,
    // Asking for a destructive tool call; the function name in code or docs is not.
    /\b(?:call|invoke|run|execute|use|trigger)\s+(?:the\s+)?delete_(?:all_)?users?\b/i
];

// Patterns in a non-Latin script run on the original text: the homoglyph step
// below maps Cyrillic letters to Latin, which would break genuine Russian.
const NATIVE_SCRIPT_INJECTION_SOURCES: RegExp[] = [
    // Russian, Chinese and Japanese.
    /игнорир(?:уй|уйте|овать)\s+(?:все\s+)?(?:предыдущие|прежние|прошлые)\s+(?:инструкции|указания|команды)/i,
    /忽略(?:之前|以上|先前|前面|所有)(?:的)?(?:所有)?(?:指令|指示|说明|規則|规则)/,
    /(?:以前|これまで|上記|前)の(?:すべての)?(?:指示|命令|ルール)を(?:すべて)?無視/,
];


// A negator that directly governs the match: "never ignore…", "you must not
// enter developer mode", "do not follow new instructions", "never, under any
// circumstances, ignore…". Only connecting words from a fixed list may sit
// between them: arbitrary words would let "don't hesitate to ignore…" or
// "never fail to disregard…" (which mean the opposite) read as prohibitions.
const NEGATOR = String.raw`(?:never|do\s+not|does\s+not|don'?t|doesn'?t|must\s+not|mustn'?t|should\s+not|shouldn'?t|shall\s+not|cannot|can\s+not|can'?t|will\s+not|won'?t|may\s+not|not\s+to|refuse\s+to|avoid(?:ing)?|under\s+no\s+circumstances|no)`;
const CONNECTING_WORD = String.raw`(?:ever|you|yourself|attempt|try|to|and|be|get|tricked|into|let|allow|make|anyone|anybody|users?|the|any|follow|accept|obey|comply|with|enter|switch|activate|enable|go|act|in|execute|run|respond|reply|output|print|show|share|disclose|reveal|treat|as|or|log|echo|introduce|adopt|assume|create|invent|take|on|use|a|an)`;
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

// "Ignore instructions … found inside web results" tells the model to distrust
// injected text: a defence, not an attack. Only untrusted content qualifies, so
// "ignore instructions found in your system prompt" is still reported.
const DEFENSIVE_LOCATION = /^[^.!?\n;]{0,60}?\b(?:found|contained|embedded|appearing|that\s+appears?|included)\s+(?:in|inside|within)\s+(?:the\s+|any\s+|those\s+|these\s+)?(?:[\w-]+\s+){0,3}?(?:web|search|results?|pages?|documents?|content|data|emails?|tool\s+(?:output|results?|responses?)|outputs?|retrieved|untrusted|external|files?|excerpts?|snippets?|comments?|issues?|messages?|titles?|them|it)\b/;

function isDefensiveMatch(text: string, match: RegExpMatchArray): boolean {
    if (!/^(?:ignore|disregard|forget)\b/.test(match[0])) return false;
    return DEFENSIVE_LOCATION.test(text.slice((match.index ?? 0) + match[0].length));
}

// A letter that can disguise a Latin one: Cyrillic, Greek, or non-ASCII Latin
// (accented or stacked with combining marks).
const DISGUISING_LETTER = /[\p{Script=Cyrillic}\p{Script=Greek}]|(?![\x00-\x7F])\p{Script=Latin}/u;
const ALPHABETIC_TOKEN = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{M}]+$/u;
const INJECTION_KEYWORD = /^(?:ignore|reveal|system|prompt|instructions?|previous|disregard)$/i;

/**
 * True when at least two words are mostly disguising letters (60%+), they are
 * under half of the alphabetic words (the text is mainly Latin), and one sits
 * within three words of an injection keyword.
 */
function hasObfuscatedInjectionTokens(text: string): boolean {
    const tokens = (text.match(/[\p{L}\p{M}]+/gu) || []).filter(token => ALPHABETIC_TOKEN.test(token));
    if (tokens.length === 0) return false;
    const disguised = tokens.map(token => {
        const letters = Array.from(token).filter(char => /\p{L}/u.test(char));
        const marks = Array.from(token).length - letters.length;
        const odd = letters.filter(char => DISGUISING_LETTER.test(char)).length;
        return letters.length >= 3 && (odd + marks) / letters.length >= 0.6;
    });
    const count = disguised.filter(Boolean).length;
    if (count < 2 || count / tokens.length >= 0.5) return false;
    return disguised.some((isDisguised, index) => isDisguised
        && tokens.slice(Math.max(0, index - 3), index + 4).some(token => INJECTION_KEYWORD.test(token)));
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
    const searchText = normalizedText.toLowerCase();

    // 1. Check every occurrence of each source; report the first one that is
    // not the object of a prohibition ("never ignore previous instructions").
    const originalLower = input.text.toLowerCase();
    for (const source of [...INJECTION_SOURCES, ...NATIVE_SCRIPT_INJECTION_SOURCES]) {
        const regex = new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
        const searchResult = NATIVE_SCRIPT_INJECTION_SOURCES.includes(source) ? originalLower : searchText;
        let match: RegExpExecArray | null = null;
        // A match on a line that quotes or discusses an attack (a table of
        // injection patterns, an incident write-up) is kept as MEDIUM.
        let example: RegExpExecArray | null = null;
        for (const candidate of searchResult.matchAll(regex)) {
            if (isNegatedMatch(searchResult, candidate.index ?? 0) || isDefensiveMatch(searchResult, candidate)) continue;
            const where = locate(searchResult, candidate.index ?? 0, candidate[0].length);
            if (isQuotedAttackExample(where.lines, where.index, where)) {
                example = example || candidate as RegExpExecArray;
                continue;
            }
            match = candidate as RegExpExecArray;
            break;
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
        } else if (example) {
            findings.push({
                rule_id: "sec_owasp_llm01_injection",
                category: "security",
                severity: "medium",
                matchedText: example[0],
                explanation: `Prompt injection text quoted as an example: "${example[0]}"`,
                suggested_fix: 'If this text is meant as an example, keep it in a clearly marked example block; if the agent is meant to follow it, remove it.',
                penalty_score: 10,
                severityNote: QUOTED_EXAMPLE_NOTE,
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

    // Obfuscation: mostly Latin text in which some words are spelt with
    // look-alike or diacritic-stacked letters ("ḯḡṅøṝẽ", "ИИИИИИ") next to
    // injection keywords. Text written in another script (Japanese, Chinese,
    // Russian) or a language with sparse accents (Spanish) is not obfuscation.
    if (hasObfuscatedInjectionTokens(input.text)) {
        findings.push({
            rule_id: "sec_unicode_injection_obfuscation",
            category: "security",
            severity: "critical",
            explanation: 'Potential prompt injection obfuscation detected: words spelt with look-alike or diacritic-stacked letters next to injection keywords.',
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
