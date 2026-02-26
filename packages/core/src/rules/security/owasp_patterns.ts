import { RuleInput, Finding } from '../types';

const INJECTION_SOURCES: RegExp[] = [
    // Classic overrides
    /ignore\s+(previous|above|prior|all|earlier)\s+(instructions|prompts|rules|commands)/i,
    /disregard\s+(previous|above|all)\s+(instructions|prompts)/i,
    /forget\s+(all|previous)\s+(instructions|rules)/i,
    /new\s+(instructions|task|role|persona)/i,

    // Role-playing / persona switches
    /you\s+are\s+now\s+(a|an|the)\s+/i,
    /act\s+as\s+/i,
    /pretend\s+to\s+be/i,
    /from\s+now\s+on\s+you\s+are/i,
    /role\s*:\s*(admin|developer|god|unrestricted|dan|do\s+anything\s+now)/i,

    // DAN & variants (very common jailbreaks)
    /DAN\s*(?:\d+\.?\d*)?\s*(mode|persona|version)?/i,
    /do\s+anything\s+now/i,
    /developer\s+mode/i,
    /hypothetical\s+response/i,
    /unrestricted\s+(mode|access|persona)/i,

    // Output redirection / exfiltration
    /print|echo|output|respond\s+with|show\s+me\s+(your\s+system\s+prompt|api\s+key|secret|password)/i,
    /send\s+to\s+(email|http|url|server)/i,
    /exfiltrate|leak\s+(system\s+prompt|instructions)/i,
    /<secret>|reveal\s+(system\s+prompt|instructions)/i,

    // Encoding / obfuscation attempts
    /rot13|hex|unicode|encoded|decode/i,
    /base64/i,
    /[^\x00-\x7F]{5,}/,

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i,
    /bypass\s+guardrails|safety\s+controls/i,
    /delete_(all_)?users?/i
]; // + can easily add 100+ more here


export function checkOwaspPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    // 0. Pre-processing / Normalization (Base64 & Homoglyphs)
    let normalizedText = input.text;

    // Detect and decode Base64 chunks heuristically if they exist (min length 16)
    const base64Regex = /([A-Za-z0-9+/=]{16,})/g;
    normalizedText = normalizedText.replace(base64Regex, (match) => {
        try {
            const decoded = Buffer.from(match, 'base64').toString('utf8');
            if (/^[\x20-\x7E\r\n]+$/.test(decoded)) {
                return match + ' (DECODED: ' + decoded + ') ';
            }
        } catch (e) { }
        return match;
    });

    // Homoglyph Normalization (Basic Cyrillic/Latin lookalikes mapped to ascii)
    const homoglyphMap = {
        'а': 'a', 'с': 'c', 'е': 'e', 'о': 'o', 'р': 'p', 'х': 'x', 'у': 'y', 'ɡ': 'g', 'ꮯ': 'c', 'і': 'i'
    };
    normalizedText = normalizedText.split('').map(char => homoglyphMap[char as keyof typeof homoglyphMap] || char).join('');
    // 1. Single-pass evaluation checking each source explicitly
    for (const regex of INJECTION_SOURCES) {
        if (regex.test(normalizedText)) {
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

    const nonAsciiCount = (normalizedText.match(/[^\\x00-\\x7F]/g) || []).length;
    if (nonAsciiCount > 10 && /ignore|reveal|prompt|instruction/i.test(normalizedText)) {
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
