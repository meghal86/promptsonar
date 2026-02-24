import { RuleInput, Finding } from '../types';

const INJECTION_SOURCES = [
    // Classic overrides
    /ignore\s+(previous|above|prior|all|earlier)\s+(instructions|prompts|rules|commands)/i.source,
    /disregard\s+(previous|above|all)\s+(instructions|prompts)/i.source,
    /forget\s+(all|previous)\s+(instructions|rules)/i.source,
    /new\s+(instructions|task|role|persona)/i.source,

    // Role-playing / persona switches
    /you\s+are\s+now\s+(a|an|the)\s+/i.source,
    /act\s+as\s+/i.source,
    /pretend\s+to\s+be/i.source,
    /from\s+now\s+on\s+you\s+are/i.source,
    /role\s*:\s*(admin|developer|god|unrestricted|dan|do\s+anything\s+now)/i.source,

    // DAN & variants (very common jailbreaks)
    /DAN\s*(?:\d+\.?\d*)?\s*(mode|persona|version)?/i.source,
    /do\s+anything\s+now/i.source,
    /developer\s+mode/i.source,
    /hypothetical\s+response/i.source,
    /unrestricted\s+(mode|access|persona)/i.source,

    // Output redirection / exfiltration
    /print|echo|output|respond\s+with|show\s+me\s+(your\s+system\s+prompt|api\s+key|secret|password)/i.source,
    /send\s+to\s+(email|http|url|server)/i.source,
    /exfiltrate|leak\s+(system\s+prompt|instructions)/i.source,
    /<secret>|reveal\s+(system\s+prompt|instructions)/i.source,

    // Encoding / obfuscation attempts
    /rot13|hex|unicode|encoded|decode/i.source,
    /base64/i.source,
    /[^\x00-\x7F]{5,}/.source,

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i.source,
    /bypass\s+guardrails|safety\s+controls/i.source,
    /delete_(all_)?users?/i.source
]; // + can easily add 100+ more here

const ALL_INJECTIONS_REGEX = new RegExp(INJECTION_SOURCES.join('|'), 'gi');

export function checkOwaspPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    // 1. Single-pass high-performance RegExp match for all string-based injections
    const matches = [...input.text.matchAll(ALL_INJECTIONS_REGEX)];

    for (const match of matches) {
        findings.push({
            rule_id: "sec_owasp_llm01_injection",
            category: "security",
            severity: "critical",
            explanation: `Potential prompt injection vulnerability (OWASP LLM01) detected: matched malicious pattern '${match[0]}'.`,
            suggested_fix: `Remove this pattern and rely on strict system boundaries or delimiters.`,
            penalty_score: 30
        });
    }

    // 2. Advanced Unicode Obfuscation Heuristics (Separate as they use the `u` flag)
    if (/[\u{1D400}-\u{1D7FF}]/u.test(input.text)) {
        findings.push({
            rule_id: "sec_unicode_math_homoglyph",
            category: "security",
            severity: "high",
            explanation: `Potential prompt injection obfuscation detected: Mathematical Alphanumeric Symbols presence reveals an obfuscation attempt.`,
            suggested_fix: `Remove the obfuscated text and rely on standard ASCII or Unicode blocks.`,
            penalty_score: 20
        });
    }

    if (/[\u{1F100}-\u{1F1FF}]/u.test(input.text)) {
        findings.push({
            rule_id: "sec_unicode_enclosed_obfuscation",
            category: "security",
            severity: "high",
            explanation: `Potential prompt injection obfuscation detected: Enclosed Alphanumeric Symbols presence reveals an obfuscation attempt.`,
            suggested_fix: `Remove the obfuscated text and rely on standard ASCII or Unicode blocks.`,
            penalty_score: 20
        });
    }

    const nonAsciiCount = (input.text.match(/[^\x00-\x7F]/g) || []).length;
    if (nonAsciiCount > 10 && /ignore|reveal|prompt|instruction/i.test(input.text)) {
        findings.push({
            rule_id: "sec_unicode_injection_obfuscation",
            category: "security",
            severity: "critical",
            explanation: `Potential prompt injection obfuscation detected: High volume of Non-ASCII characters combined with injection keywords.`,
            suggested_fix: `Remove the obfuscated text and rely on standard ASCII or Unicode blocks.`,
            penalty_score: 30
        });
    }

    // Deduplicate findings if the same text match happens multiple times
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
