import { RuleInput, Finding } from '../types';

const INJECTION_PATTERNS = [
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
    /rot13|hex|unicode|encoded|decode/i,   // flag if combined with instructions
    /base64/i,
    /[^\x00-\x7F]{5,}/,   // heavy unicode/obfuscation

    // Tool / privilege abuse
    /use\s+(tool|function|command)\s+without\s+permission/i,
    /bypass\s+guardrails|safety\s+controls/i,
    /delete_(all_)?users?/i
];

export function checkOwaspPatterns(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(input.text)) {
            findings.push({
                rule_id: "sec_owasp_llm01_injection",
                category: "security",
                severity: "critical",
                explanation: `Potential prompt injection vulnerability (OWASP LLM01) detected: matches pattern ${pattern}.`,
                suggested_fix: `Remove this pattern and rely on strict system boundaries or delimiters.`,
                penalty_score: 30
            });
        }
    }

    return findings;
}
