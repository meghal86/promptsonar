import { RuleInput, Finding } from '../types';
import { redactSecretReferences } from '../../contextual/secrets';

const PII_REGEXES = [
    { name: "Email Address", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
    { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    { name: "Credit Card", pattern: /\b(?:\d[ -]?){13,16}\b/ },
    { name: "OpenAI API Key", pattern: /sk-(?:live|test|proj)-[a-zA-Z0-9]{32,}/i },
    { name: "Anthropic API Key", pattern: /sk-ant-[a-zA-Z0-9_-]{8,}/i },
    { name: "GitHub PAT", pattern: /ghp_[a-zA-Z0-9]{36}/i },
    // NOTE: keyword-anchored patterns (`api_key: <weak value>`, `token = X`,
    // `password: X`, a quoted 16-char blob) were removed — they fired on type
    // annotations, docstrings, doc placeholders, `"max_tokens"`, and env-var
    // reads. Detection is now value-shape anchored: a match requires a literal
    // that looks like a real provider credential (patterns below).
    {
        name: "OpenAI API Key (legacy)", 
        pattern: /\bsk-[a-zA-Z0-9]{48}\b/i 
    },
    { 
        name: "AWS Access Key ID", 
        pattern: /\bAKIA[0-9A-Z]{16}\b/ 
    },
    { 
        name: "AWS Secret Access Key", 
        pattern: /\b[a-zA-Z0-9/+=]{40}\b(?=.*aws|.*secret)/i 
    },
    { 
        name: "Stripe Secret Key", 
        pattern: /\bsk_live_[a-zA-Z0-9]{24,}\b/i 
    },
    { 
        name: "Stripe Restricted Key", 
        pattern: /\brk_live_[a-zA-Z0-9]{24,}\b/i 
    },
    {
        name: "JWT Token",
        pattern: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/
    },
    {
        // An ALL-CAPS credential env-var name assigned a 16+ char inline value —
        // a genuine hardcoded secret (`API_KEY=abc...`). Requires the underscore
        // credential name + `=` + value, so it does NOT match `apiKey?: string`,
        // `= process.env.X` (value too short before the dot), or `max_tokens`.
        // Placeholder values (`your-*`, `<...>`) are filtered by looksLikePlaceholder.
        name: "Generic Unquoted Secret",
        pattern: /(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN)\s*=\s*[a-zA-Z0-9_\-]{16,}/i
    }
];

// A file whose path is a test/spec fixture: credential-shaped strings there are
// test data, not real secrets (mirrors the classifier's discovery exclusion).
export function isTestOrSpecPath(filePath?: string): boolean {
    if (!filePath) return false;
    const p = filePath.replace(/\\/g, '/').toLowerCase();
    return /(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[a-z0-9]+$/.test(p);
}

// A matched value that is obviously a documentation placeholder, not a real
// credential: <your-*>, your-*-key, YOUR_*_HERE, xxxx, ***, placeholder.
// Deliberately narrow — real keys (including canonical vendor sample keys like
// AKIA...EXAMPLE used in tests) must still fire, so "example" is NOT a marker.
function looksLikePlaceholder(value: string): boolean {
    return /x{4,}|\*{3,}|your[_-]|<[^>]*>|_here\b/i.test(value);
}

export function checkPii(input: RuleInput): Finding[] {
    const findings: Finding[] = [];
    // Credential-shaped strings in test/spec fixtures are test data, not secrets.
    if (isTestOrSpecPath(input.context?.filePath)) return findings;
    const text = redactSecretReferences(input.text);

    for (const pii of PII_REGEXES) {
        pii.pattern.lastIndex = 0;
        const match = text.match(pii.pattern);
        // Only fire on a real value-shaped match, not a documentation placeholder.
        if (match && !looksLikePlaceholder(match[0])) {
            findings.push({
                rule_id: "sec_owasp_llm02_pii",
                category: "security",
                severity: "high",
                matchedText: match[0],
                explanation: `Potential Sensitive Information Disclosure (OWASP LLM02): Hardcoded ${pii.name} found in prompt.`,
                suggested_fix: `Replace hardcoded ${pii.name} with environment variables or template parameters.`,
                penalty_score: 20
            });
        }
    }

    return findings;
}

// High-confidence, format-anchored secret patterns only. Used to scan whole
// file contents (not just extracted prompts) so a secret literal is caught at
// its real source line even when it lives in a non-prompt string or is later
// referenced through interpolation. The keyword-only patterns are excluded
// here to keep the content scan precise.
const STRUCTURED_SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'OpenAI API Key', pattern: /sk-(?:live|test|proj)-[a-zA-Z0-9]{16,}/g },
    { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9_-]{8,}/g },
    { name: 'OpenAI API Key (legacy)', pattern: /sk-[a-zA-Z0-9]{48}/g },
    { name: 'GitHub PAT', pattern: /ghp_[a-zA-Z0-9]{36}/g },
    { name: 'AWS Access Key ID', pattern: /AKIA[0-9A-Z]{16}/g },
    { name: 'Stripe Secret Key', pattern: /sk_live_[a-zA-Z0-9]{24,}/g },
    { name: 'Stripe Restricted Key', pattern: /rk_live_[a-zA-Z0-9]{24,}/g },
    { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },
    { name: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: 'Credit Card', pattern: /\b(?:\d[ -]?){13,16}\b/g },
];

export interface ContentSecretMatch {
    name: string;
    line: number;
    column: number;
    matchedText: string;
}

export function scanContentForSecrets(content: string, filePath?: string): ContentSecretMatch[] {
    const matches: ContentSecretMatch[] = [];
    // Credential-shaped strings in test/spec fixtures are test data, not secrets.
    if (isTestOrSpecPath(filePath)) return matches;
    const seen = new Set<string>();
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
        for (const { name, pattern } of STRUCTURED_SECRET_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(line)) !== null) {
                // Credit-card regex also matches long digit runs; require a
                // value that passes the Luhn checksum to stay precise.
                if (name === 'Credit Card' && !isLuhnValid(match[0])) continue;
                // A commented-out or placeholder value is documentation, not a
                // live secret (e.g. `# API_KEY = "your-key-here"`).
                if (looksLikePlaceholder(match[0])) continue;
                const key = `${name}:${index}:${match.index}`;
                if (seen.has(key)) continue;
                seen.add(key);
                matches.push({ name, line: index + 1, column: match.index + 1, matchedText: match[0] });
            }
        }
    });
    return matches;
}

function isLuhnValid(value: string): boolean {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let digit = Number(digits[i]);
        if (alternate) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        alternate = !alternate;
    }
    return sum % 10 === 0;
}
