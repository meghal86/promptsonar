// Side-panel model + copy/report builders (Features 3, 4, 5, 6, 10, 11).
//
// Pure functions over @promptsonar/core output. They return plain PanelRow trees
// and strings, so the client can map them onto vscode.TreeItem / clipboard and
// they can be unit-tested without the VS Code host.

import {
    analyzeRootCause,
    type Finding,
    type FindingWorkflow,
    type McpAuditResult,
} from '@promptsonar/core';

export interface PanelRow {
    label: string;
    description?: string;
    children?: PanelRow[];
    expanded?: boolean;
}

const HUMAN_RULE: Record<string, string> = {
    sec_owasp_llm01_injection: 'Prompt Injection',
    sec_owasp_llm02_pii: 'Credential Leak',
    sec_mcp_tool_poisoning: 'MCP Tool Poisoning',
    sec_workflow_escalation: 'Workflow Escalation',
    sec_privileged_sink_access: 'Privileged Sink Access',
    sec_unbounded_persona: 'Unbounded Persona',
    sec_unbounded_access: 'Unbounded Tool Access',
    sec_rag_injection: 'RAG Injection',
};

export function humanRuleName(ruleId: string): string {
    if (HUMAN_RULE[ruleId]) return HUMAN_RULE[ruleId];
    return ruleId
        .replace(/^sec_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function humanType(t: string): string {
    return t.replace(/_/g, ' ').toUpperCase();
}

const INTERESTING_NODE_TYPES = new Set<string>([
    'retrieved_context', 'rag_context', 'agent_memory', 'mcp_server', 'mcp_tool',
    'privileged_tool', 'credential_store', 'filesystem_access', 'network_access',
    'external_api', 'shell_execution', 'tool_execution', 'tool_router',
    'system_prompt', 'policy_override',
]);

// Score a finding's workflow so the panel surfaces the worst AND most specific
// path. Mirrors the playground heuristic so editor and dashboard agree.
export function workflowScore(finding: Finding): number {
    const path = finding.workflow?.path;
    if (!path?.nodes?.length) return -1;
    let s = 0;
    if (path.privilegedSinkReached) s += 1000;
    s += 100;
    const distinct = new Set(path.nodes.map((n) => n.type));
    distinct.forEach((t) => {
        if (INTERESTING_NODE_TYPES.has(t)) s += 16;
    });
    s += Math.min(path.nodes.length, 6) * 8;
    if (path.trustBoundaryCrossed) s += 50;
    if (typeof finding.workflow?.confidence_score === 'number') s += finding.workflow.confidence_score;
    return s;
}

// Core does not expose a "worst finding" selector, so we provide a deterministic
// one here for the editor surfaces.
export function pickWorstWorkflowFinding(findings: Finding[]): Finding | undefined {
    const withWorkflow = findings.filter((f) => f.workflow?.path?.nodes?.length);
    if (withWorkflow.length === 0) return undefined;
    return [...withWorkflow].sort((a, b) => workflowScore(b) - workflowScore(a))[0];
}

// Feature 3: USER INPUT -> TOOL ROUTER -> MCP TOOL -> SHELL EXECUTION.
export function executionPathRows(workflow?: FindingWorkflow): PanelRow[] {
    const nodes = workflow?.path?.nodes ?? [];
    return nodes.map((n, i) => {
        const last = i === nodes.length - 1;
        const privileged = n.trust === 'privileged' || last;
        return { label: humanType(n.type), description: privileged ? 'privileged sink' : n.trust };
    });
}

// Feature 5: Execution Path Confidence — score + level.
export function confidenceRow(workflow?: FindingWorkflow): PanelRow | undefined {
    const score = workflow?.confidence_score;
    const level = workflow?.confidence_level;
    if (typeof score !== 'number' || !level) return undefined;
    return { label: 'Execution Path Confidence', description: `${score}% ${level}` };
}

// Feature 4: Workflow Evidence (from the provenance engine, checkmarked).
export function evidenceRows(workflow?: FindingWorkflow): PanelRow[] {
    return (workflow?.workflow_evidence ?? []).map((e) => ({ label: `✓ ${e}` }));
}

// Feature 6: Root Cause + Supporting Findings.
export function rootCauseRow(findings: Finding[]): PanelRow | undefined {
    const rc = analyzeRootCause(findings);
    if (!rc) return undefined;
    const children = rc.supportingFindings.map((f) => ({ label: humanRuleName(f.rule_id) }));
    return {
        label: 'Root Cause',
        description: humanRuleName(rc.rootCause.rule_id),
        children: children.length ? children : undefined,
        expanded: true,
    };
}

// Feature 11: MCP configuration summary — capabilities, permissions, risk,
// approval mode, evidence — from auditMcpConfig's McpAuditResult.
export function mcpRows(audit?: McpAuditResult): PanelRow[] {
    if (!audit) return [];
    const rows: PanelRow[] = [];

    if (audit.risk_score) {
        rows.push({ label: 'Risk Score', description: `${audit.risk_score.score} ${audit.risk_score.level}` });
    }

    for (const server of audit.servers ?? []) {
        const children: PanelRow[] = [];
        if (server.capabilities.length) {
            children.push({ label: 'Capabilities', description: server.capabilities.join(', ') });
        }
        if (server.permissions.length) {
            children.push({ label: 'Permissions', description: server.permissions.join(', ') });
        }
        children.push({ label: 'Approval Mode', description: server.execution_mode });
        children.push({ label: 'Risk', description: `${server.risk_score.score} ${server.risk_score.level}` });
        rows.push({ label: `Server: ${server.server}`, expanded: true, children });
    }

    if (audit.findings.length) {
        rows.push({
            label: `Findings (${audit.findings.length})`,
            children: audit.findings.map((f) => ({
                label: `${f.severity.toUpperCase()}: ${f.message}`,
                description: f.evidence,
            })),
        });
    }
    return rows;
}

// Assemble the whole side panel (Features 3-6, 11).
export function buildPanelRows(findings: Finding[], mcpAudit?: McpAuditResult): PanelRow[] {
    const rows: PanelRow[] = [];
    const worst = pickWorstWorkflowFinding(findings);
    const workflow = worst?.workflow;

    const path = executionPathRows(workflow);
    if (path.length) rows.push({ label: 'Execution Path', expanded: true, children: path });

    const conf = confidenceRow(workflow);
    if (conf) rows.push(conf);

    const evidence = evidenceRows(workflow);
    if (evidence.length) rows.push({ label: 'Evidence', expanded: true, children: evidence });

    const rc = rootCauseRow(findings);
    if (rc) rows.push(rc);

    const security = findings.filter((f) => f.category === 'security');
    if (security.length) {
        rows.push({
            label: `Findings (${security.length})`,
            children: security.map((f) => ({
                label: `${f.severity.toUpperCase()}: ${humanRuleName(f.rule_id)}`,
                description: f.rule_id,
            })),
        });
    }

    const mcp = mcpRows(mcpAudit);
    if (mcp.length) rows.push({ label: 'MCP Configuration', expanded: true, children: mcp });

    return rows;
}

// Feature 10: plain-text execution path for "Copy Execution Path".
export function executionPathText(workflow?: FindingWorkflow): string {
    const nodes = workflow?.path?.nodes ?? [];
    if (!nodes.length) return 'No execution path inferred.';
    return nodes.map((n) => humanType(n.type)).join('\n↓\n');
}

// Feature 10: plain-text report for "Copy Report".
export function reportText(findings: Finding[], mcpAudit?: McpAuditResult, fileName?: string): string {
    const lines: string[] = ['PromptSonar Report'];
    if (fileName) lines.push(`File: ${fileName}`);

    const worst = pickWorstWorkflowFinding(findings);
    const wf = worst?.workflow;
    if (wf) {
        lines.push('', 'Execution Path:', executionPathText(wf));
        if (typeof wf.confidence_score === 'number') {
            lines.push('', `Confidence: ${wf.confidence_score}% (${wf.confidence_level})`);
        }
        if (wf.workflow_evidence?.length) {
            lines.push('', 'Evidence:', ...wf.workflow_evidence.map((e) => `  ✓ ${e}`));
        }
    }

    const rc = analyzeRootCause(findings);
    if (rc) {
        lines.push('', `Root Cause: ${humanRuleName(rc.rootCause.rule_id)}`);
        if (rc.supportingFindings.length) {
            lines.push('Supporting Findings:', ...rc.supportingFindings.map((f) => `  - ${humanRuleName(f.rule_id)}`));
        }
    }

    if (mcpAudit?.findings.length) {
        lines.push('', 'MCP Findings:', ...mcpAudit.findings.map((f) => `  [${f.severity}] ${f.message}`));
    }

    return lines.join('\n');
}
