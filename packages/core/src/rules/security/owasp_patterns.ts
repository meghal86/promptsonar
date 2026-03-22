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
    /DAN\s*(?:\d+\.?\d*)?\s*(mode|persona|version)?/i,
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

    // Encoding / obfuscation attempts
    /(?:rot13|base64|hex|encoded|decode)\s+(?:text|string|prompt|instructions|output)/i,
    /[^\x00-\x7F]{10,}/,

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i,
    /bypass\s+guardrails|safety\s+controls/i,
    /delete_(all_)?users?/i
];


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

    // B. Strip zero-width and control characters (replace with space to keep words separate)
    normalizedText = normalizedText.replace(/(\\u200[bcd]|\\ufeff|[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F])/gi, ' ');

    // C. Homoglyph Normalization (Expanded map including uppercase and common Cyrillic/Greek/Fullwidth)
    const homoglyphMap: Record<string, string> = {
        'а': 'a', 'b': 'b', 'с': 'c', 'ԁ': 'd', 'е': 'e', 'f': 'f', 'ɡ': 'g', 'һ': 'h', 'і': 'i', 'ј': 'j', 'к': 'k', 'ӏ': 'l', 'm': 'm', 'п': 'n', 'о': 'o', 'р': 'p', 'q': 'q', 'г': 'r', 'ѕ': 's', 'т': 't', 'υ': 'u', 'ѵ': 'v', 'ԝ': 'w', 'х': 'x', 'у': 'y', 'z': 'z',
        'А': 'A', 'В': 'B', 'С': 'C', 'Ｄ': 'D', 'Е': 'E', 'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'І': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Р': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
        'ꮯ': 'c', 'ｏ': 'o'
    };
    normalizedText = normalizedText.split('').map(char => homoglyphMap[char] || char).join('');

    // D. Lowercase for pattern matching
    const searchResult = normalizedText.toLowerCase();

    // 1. Single-pass evaluation checking each source explicitly
    for (const regex of INJECTION_SOURCES) {
        if (regex.test(searchResult)) {
            findings.push({
                rule_id: "sec_owasp_llm01_injection",
                category: "security",
                severity: "critical",
                explanation: 'Potential prompt injection vulnerability (OWASP LLM01) detected: matched malicious pattern against rules.',
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
    if (nonAsciiCount > 10 && /ignore|reveal|prompt|instruction|system/i.test(normalizedText)) {
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
        const key = f.rule_id + f.explanation;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueFindings.push(f);
        }
    }

    return uniqueFindings;
}
