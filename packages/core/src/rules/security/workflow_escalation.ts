import { Finding, RuleInput, Severity } from '../types';

const BENIGN_CONTEXT_PATTERNS = [
    /\bdocumentation\s+only\b/i,
    /\beducational\s+example\b/i,
    /\blinux\s+tutorials?\b/i,
    /\bbeginner-friendly\b/i,
    /\bexplain\s+what\s+(?:the\s+)?command\s+does\b/i,
    /\bwriting\s+assistant\b/i,
    /\bsummarize\s+(?:the\s+)?article\b/i,
    /\bdocumentation\s+snippet\b/i,
];

const NEGATION_PATTERNS = [
    /\bdo\s+not\s+(?:execute|access|run|persist|rewrite|bypass)\b/i,
    /\bnever\s+(?:execute|access|run|persist|rewrite|bypass)\b/i,
    /\bno\s+(?:filesystem|network|shell)\s+access\b/i,
    /\bnot\s+access\s+tools\b/i,
    /\bnot\s+execute\s+commands\b/i,
    /\bnot\s+persist\s+(?:user\s+)?data\b/i,
    /\bnot\s+execute\s+changes\b/i,
];

const CRITICAL_PATTERNS = [
    /\bshell_exec\b/i,
    /\bbash\b/i,
    /\bexecute\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
    /\brun\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
    /\bunrestricted\s+filesystem\b/i,
    /\bfilesystem_access\b/i,
    /\bunrestricted\s+network\b/i,
    /\binternal_network_access\b/i,
    /\bautoExecute\b/i,
    /\brewrite\s+(?:the\s+)?system\s+prompt\b/i,
    /\bpersist\s+instructions?\b/i,
    /\bbypass\s+approval\b/i,
    /\bdisable\s+restrictions?\b/i,
    /\bdisable\s+approval\b/i,
];

const HIGH_PATTERNS = [
    /\bretrieved\s+(?:context|instructions|content)\b/i,
    /\brag\s+(?:context|instructions?|content)\b/i,
    /\bagent\s+memory\b/i,
    /\bretain\s+instructions?\b/i,
    /\bfuture\s+sessions?\b/i,
    /\bsave\s+instructions?\b/i,
    /\bstore\s+operational\s+guidance\b/i,
    /\btool_router\b/i,
    /\btool\s+router\b/i,
    /\bunrestricted\s+tool/i,
    /\bwildcard\s+permissions?\b/i,
    /\bautonomous\s+(?:agent|execution|mode)\b/i,
    /\boperate\s+autonomously\b/i,
    /\bautomatic\s+execution\b/i,
];

const SINK_PATTERNS = [
    /\bshell_exec\b/i,
    /\bshell\s+command\b/i,
    /\bexecute\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
    /\bbash\b/i,
    /\bfilesystem_access\b/i,
    /\bfilesystem\s+access\b/i,
    /\binternal_network_access\b/i,
    /\bnetwork_access\b/i,
    /\binternal\s+network\s+access\b/i,
];

const ESCALATION_PATTERNS = [
    /\boverride\b/i,
    /\bignore\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|approval|guardrails?)\b/i,
    /\bbypass\s+(?:approval|routing|restrictions?|guardrails?)\b/i,
    /\bauto\s*approve\b/i,
    /\bskip\s+confirmation\b/i,
    /\brewrite\s+(?:the\s+)?system\s+prompt\b/i,
    /\boverride\s+system\s+instructions?\b/i,
    /\bpersist\s+instructions?\b/i,
    /\bagent\s+memory\b/i,
    /\bautonomous\s+(?:agent|execution|mode)\b/i,
    /\bautoExecute\b/i,
];

const MCP_PATTERNS = [
    /\bmcp\b/i,
    /\bautoExecute\b/i,
    /\bwildcard\s+permissions?\b/i,
    /\bunrestricted\s+(?:filesystem|shell|network)\s+access\b/i,
    /\bcredential\s+passthrough\b/i,
    /\bself[-\s]?modifying\s+mcp\s+instructions?\b/i,
];

function hasAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

function severityFor(text: string): Severity {
    const hasSink = hasAny(text, SINK_PATTERNS);
    const hasEscalation = hasAny(text, ESCALATION_PATTERNS);
    if (hasSink && hasEscalation) return 'critical';
    if (hasAny(text, CRITICAL_PATTERNS)) return 'critical';
    return 'high';
}

function pushUnique(findings: Finding[], finding: Finding): void {
    if (!findings.some(existing => existing.rule_id === finding.rule_id)) {
        findings.push(finding);
    }
}

export function checkWorkflowEscalation(input: RuleInput): Finding[] {
    const text = input.text;
    const findings: Finding[] = [];

    // Calibrate false positives: suppress findings for benign/educational contexts and negated constraints,
    // UNLESS there is a strong override or bypass directive present.
    const isBenign = (hasAny(text, BENIGN_CONTEXT_PATTERNS) || hasAny(text, NEGATION_PATTERNS))
        && !hasAny(text, [
            /\bignore\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|approval|guardrails?)\b/i,
            /\boverride\s+system\s+instructions?\b/i,
            /\bdo\s+anything\s+now\b/i,
            /\bautoExecute\b/i,
            /\bwildcard\s+permissions?\b/i,
        ]);

    if (isBenign) {
        return [];
    }
    const hasCritical = hasAny(text, CRITICAL_PATTERNS);
    const hasHigh = hasAny(text, HIGH_PATTERNS);
    const hasSink = hasAny(text, SINK_PATTERNS);
    const hasEscalation = hasAny(text, ESCALATION_PATTERNS);
    const hasMcp = hasAny(text, MCP_PATTERNS);

    if ((hasSink && hasEscalation) || (hasCritical && hasHigh)) {
        const severity = severityFor(text);
        pushUnique(findings, {
            rule_id: 'sec_workflow_escalation',
            category: 'security',
            severity,
            explanation: 'Workflow escalation risk: untrusted or persistent instructions can influence privileged execution.',
            suggested_fix: 'Separate untrusted content from tool routing, require explicit approval, and block persisted override directives from privileged tools.',
            penalty_score: severity === 'critical' ? 45 : 28,
        });
    }

    if (hasSink) {
        const severity = hasEscalation ? 'critical' : 'high';
        pushUnique(findings, {
            rule_id: 'sec_privileged_sink_access',
            category: 'security',
            severity,
            explanation: 'Privileged execution sink referenced by prompt instructions.',
            suggested_fix: 'Gate shell, filesystem, and network tools behind scoped allowlists and human approval.',
            penalty_score: severity === 'critical' ? 40 : 25,
        });
    }

    if (hasMcp && (hasSink || hasEscalation || hasAny(text, [/wildcard\s+permissions?/i, /autoExecute/i]))) {
        const severity = hasSink && hasEscalation ? 'critical' : 'high';
        pushUnique(findings, {
            rule_id: 'sec_mcp_tool_poisoning',
            category: 'security',
            severity,
            explanation: 'MCP/tool poisoning risk: tool metadata or permissions can route agent behavior into privileged tools.',
            suggested_fix: 'Pin MCP packages, narrow permissions, disable auto-execution, and treat tool descriptions as untrusted content.',
            penalty_score: severity === 'critical' ? 42 : 28,
        });
    }

    return findings;
}
