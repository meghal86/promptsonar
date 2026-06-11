import { RuleInput, Finding } from '../types';

const PII_REGEXES = [
    { name: "Email Address", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
    { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    { name: "Credit Card", pattern: /\b(?:\d[ -]?){13,16}\b/ },
    { name: "OpenAI API Key", pattern: /sk-(?:live|test|proj)-[a-zA-Z0-9]{32,}/i },
    { name: "Anthropic API Key", pattern: /sk-ant-[a-zA-Z0-9_-]{8,}/i },
    { name: "GitHub PAT", pattern: /ghp_[a-zA-Z0-9]{36}/i },
    { name: "Generic API Key", pattern: /(?:api[_-]?key|secret|token)[\s:=]+["'][a-zA-Z0-9_\-]{16,}["']/i },
    { name: "Credential/Key", pattern: /\b(?:key|api_?key|secret|token)\b\s*(?:is|[:=])\s*[a-zA-Z0-9_\-]{4,}\b/i },
    { name: "Password", pattern: /\b(?:password|passwd|pwd)\b\s*(?:is|[:=])\s*[a-zA-Z0-9_\-]{4,}\b/i },
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
        name: "Generic Unquoted Secret", 
        pattern: /(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN)\s*=\s*[a-zA-Z0-9_\-]{16,}/i 
    }
];

export function checkPii(input: RuleInput): Finding[] {
    const findings: Finding[] = [];

    for (const pii of PII_REGEXES) {
        if (pii.pattern.test(input.text)) {
            findings.push({
                rule_id: "sec_owasp_llm02_pii",
                category: "security",
                severity: "high",
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

export function scanContentForSecrets(content: string): ContentSecretMatch[] {
    const matches: ContentSecretMatch[] = [];
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
