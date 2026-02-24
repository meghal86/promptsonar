import { RuleInput, Finding } from '../types';

const PII_REGEXES = [
    { name: "Email Address", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
    { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    { name: "Credit Card", pattern: /\b(?:\d[ -]*?){13,16}\b/ },
    { name: "OpenAI API Key", pattern: /sk-(?:live|test|proj)-[a-zA-Z0-9]{32,}/i },
    { name: "GitHub PAT", pattern: /ghp_[a-zA-Z0-9]{36}/i },
    { name: "Generic API Key", pattern: /(?:api[_-]?key|secret|token)[\s:=]+["'][a-zA-Z0-9_\-]{16,}["']/i }
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
