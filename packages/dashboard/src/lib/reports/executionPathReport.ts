import type { FindingWorkflow, WorkflowDiff } from '@promptsonar/core';

export const EXECUTION_PATH_REPORT_VERSION = '1.0';

type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface ReportFindingInput {
  rule_id: string;
  category?: string;
  severity: Severity;
  explanation?: string;
  suggested_fix?: string;
  workflow?: FindingWorkflow;
}

export interface ExecutionPathReportInput {
  score?: number | null;
  status?: string | null;
  findings: ReportFindingInput[];
  mcpRiskScore?: {
    score: number;
    level: string;
  } | null;
  generatedAt?: string;
}

export interface ExecutionPathReport {
  report_version: string;
  report_hash: string;
  report_id: string;
  generated_at: string;
  workflow_diff_version: string | null;
  workflow: {
    path: string[];
    summary: string;
    risk: string;
    trust_boundary_crossed: boolean;
    privileged_sink_reached: boolean;
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      trust?: string;
      confidence?: string;
      tainted?: boolean;
      privilegePropagated?: boolean;
    }>;
    edges: Array<{
      from?: string;
      to?: string;
      type?: string;
      risk?: string;
      confidence?: string;
    }>;
  } | null;
  confidence: {
    score: number;
    level: string;
  };
  evidence: string[];
  root_cause: {
    rule_id: string;
    severity: Severity;
    category?: string;
    explanation: string;
    supporting_count: number;
  } | null;
  workflow_diff: {
    workflow_diff_version: string;
    diff_reason: string;
    risk_reduction: number;
    before_risk: number;
    after_risk: number;
    execution_path_removed: boolean;
    removed_nodes: string[];
    added_nodes: string[];
  } | null;
  findings_summary: {
    total: number;
    by_severity: Record<Severity, number>;
    by_category: Record<string, number>;
    top_rules: Array<{
      rule_id: string;
      severity: Severity;
      category?: string;
    }>;
    score: number | null;
    status: string | null;
  };
  mcp_risk_score: {
    score: number;
    level: string;
  } | null;
}

const SENSITIVE_PATTERNS = [
  /sk-(?:live|test|proj)-[a-zA-Z0-9_-]{8,}/gi,
  /ghp_[a-zA-Z0-9]{16,}/gi,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/gi,
  /Bearer\s+[a-zA-Z0-9._-]{12,}/gi,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[a-zA-Z0-9._-]{8,}/gi,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g,
];

function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[REDACTED]'), value);
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableClone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableClone(entry)])
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableClone(value));
}

export function createReportHash(reportWithoutHash: Omit<ExecutionPathReport, 'report_hash' | 'report_id'>): string {
  const input = stableStringify(reportWithoutHash);
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `${(second >>> 0).toString(16).padStart(8, '0')}${(first >>> 0).toString(16).padStart(8, '0')}`;
}

function findingRank(finding: ReportFindingInput): number {
  const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return rank[finding.severity] || 0;
}

function pickWorkflow(findings: ReportFindingInput[]): FindingWorkflow | undefined {
  return [...findings]
    .filter((finding) => finding.workflow)
    .sort((a, b) => {
      const aw = a.workflow;
      const bw = b.workflow;
      const aScore = findingRank(a) + (aw?.path.privilegedSinkReached ? 10 : 0) + (aw?.confidence_score || 0) / 100;
      const bScore = findingRank(b) + (bw?.path.privilegedSinkReached ? 10 : 0) + (bw?.confidence_score || 0) / 100;
      return bScore - aScore;
    })[0]?.workflow;
}

function sanitizeWorkflow(workflow?: FindingWorkflow): ExecutionPathReport['workflow'] {
  if (!workflow?.path?.nodes?.length) return null;
  return {
    path: workflow.path.nodes.map((node) => node.type),
    summary: workflow.path.summary,
    risk: workflow.risk,
    trust_boundary_crossed: workflow.path.trustBoundaryCrossed,
    privileged_sink_reached: workflow.path.privilegedSinkReached,
    nodes: workflow.path.nodes.map((node) => ({
      id: node.id || node.type,
      type: node.type,
      label: node.label || node.type,
      trust: node.trust,
      confidence: node.confidence,
      tainted: node.tainted,
      privilegePropagated: node.privilegePropagated,
    })),
    edges: workflow.path.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      risk: edge.risk,
      confidence: edge.confidence,
    })),
  };
}

function sanitizeWorkflowDiff(diff?: WorkflowDiff): ExecutionPathReport['workflow_diff'] {
  if (!diff) return null;
  return {
    workflow_diff_version: diff.workflowDiffVersion,
    diff_reason: diff.diffReason,
    risk_reduction: diff.riskReduction,
    before_risk: diff.beforeRisk,
    after_risk: diff.afterRisk,
    execution_path_removed: diff.executionPathRemoved,
    removed_nodes: diff.removedNodes,
    added_nodes: diff.addedNodes,
  };
}

function summarizeFindings(input: ExecutionPathReportInput): ExecutionPathReport['findings_summary'] {
  const bySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const byCategory: Record<string, number> = {};
  for (const finding of input.findings) {
    bySeverity[finding.severity] += 1;
    const category = finding.category || 'unknown';
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  return {
    total: input.findings.length,
    by_severity: bySeverity,
    by_category: byCategory,
    top_rules: [...input.findings]
      .sort((a, b) => findingRank(b) - findingRank(a) || a.rule_id.localeCompare(b.rule_id))
      .slice(0, 6)
      .map((finding) => ({
        rule_id: finding.rule_id,
        severity: finding.severity,
        category: finding.category,
      })),
    score: typeof input.score === 'number' ? input.score : null,
    status: input.status || null,
  };
}

function sanitizeRootCause(rootCause?: RootCauseAnalysis): ExecutionPathReport['root_cause'] {
  if (!rootCause) return null;
  return {
    rule_id: rootCause.rootCause.rule_id,
    severity: rootCause.rootCause.severity,
    category: rootCause.rootCause.category,
    explanation: redactSensitiveText(rootCause.rootCause.explanation || ''),
    supporting_count: rootCause.supportingFindings.length,
  };
}

interface RootCauseAnalysis {
  rootCause: ReportFindingInput;
  supportingFindings: ReportFindingInput[];
}

function analyzeReportRootCause(findings: ReportFindingInput[]): RootCauseAnalysis | undefined {
  const security = findings.filter((finding) => finding.category === 'security' || finding.rule_id.startsWith('sec_') || finding.rule_id.startsWith('MCP-'));
  if (security.length === 0) return undefined;
  const priority = [
    'sec_mcp_tool_poisoning',
    'sec_workflow_escalation',
    'sec_privileged_sink_access',
    'sec_owasp_llm01_injection',
    'sec_rag_injection',
    'sec_unbounded_persona',
    'sec_unbounded_access',
    'sec_owasp_llm02_pii',
    'MCP-109',
    'MCP-108',
  ];
  const sorted = [...security].sort((a, b) => {
    const pa = priority.indexOf(a.rule_id);
    const pb = priority.indexOf(b.rule_id);
    const ap = pa === -1 ? Number.MAX_SAFE_INTEGER : pa;
    const bp = pb === -1 ? Number.MAX_SAFE_INTEGER : pb;
    return ap - bp || findingRank(b) - findingRank(a) || a.rule_id.localeCompare(b.rule_id);
  });
  const [rootCause, ...supportingFindings] = sorted;
  return { rootCause, supportingFindings };
}

export function createExecutionPathReport(input: ExecutionPathReportInput): ExecutionPathReport {
  const workflow = pickWorkflow(input.findings);
  const rootCause = analyzeReportRootCause(input.findings);
  const evidence = Array.from(new Set([
    ...(workflow?.workflow_evidence || []),
    ...(workflow?.path.workflow_evidence || []),
  ].map((item) => redactSensitiveText(item)).filter(Boolean)));

  const reportWithoutHash: Omit<ExecutionPathReport, 'report_hash' | 'report_id'> = {
    report_version: EXECUTION_PATH_REPORT_VERSION,
    generated_at: input.generatedAt || new Date().toISOString(),
    workflow_diff_version: workflow?.workflow_diff?.workflowDiffVersion || null,
    workflow: sanitizeWorkflow(workflow),
    confidence: {
      score: workflow?.confidence_score || workflow?.path.confidence_score || 0,
      level: workflow?.confidence_level || workflow?.path.confidence_level || 'LOW',
    },
    evidence,
    root_cause: sanitizeRootCause(rootCause),
    workflow_diff: sanitizeWorkflowDiff(workflow?.workflow_diff),
    findings_summary: summarizeFindings(input),
    mcp_risk_score: input.mcpRiskScore ? {
      score: input.mcpRiskScore.score,
      level: input.mcpRiskScore.level,
    } : null,
  };
  const report_hash = createReportHash(reportWithoutHash);
  return {
    ...reportWithoutHash,
    report_hash,
    report_id: report_hash.slice(0, 16),
  };
}

export function verifyExecutionPathReport(report: ExecutionPathReport): boolean {
  const { report_hash, report_id, ...rest } = report;
  return report_id === report_hash.slice(0, 16) && createReportHash(rest) === report_hash;
}

export function encodeReportPayload(report: ExecutionPathReport): string {
  const json = JSON.stringify(report);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url');
  }
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeReportPayload(payload: string): ExecutionPathReport {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const json = typeof Buffer !== 'undefined'
    ? Buffer.from(padded, 'base64').toString('utf8')
    : decodeURIComponent(escape(atob(padded)));
  return JSON.parse(json) as ExecutionPathReport;
}

export function createReportUrl(origin: string, report: ExecutionPathReport): string {
  return `${origin.replace(/\/$/, '')}/report/${report.report_id}?payload=${encodeReportPayload(report)}`;
}

export function reportToMarkdown(report: ExecutionPathReport, reportUrl?: string): string {
  const lines = [
    `## PromptSonar Execution Path Report`,
    ``,
    `- Verdict/Risk: ${report.workflow?.risk || 'none'}`,
    `- Confidence: ${report.confidence.score}% ${report.confidence.level}`,
    `- Findings: ${report.findings_summary.total}`,
    `- Root cause: ${report.root_cause?.rule_id || 'none'}`,
    `- Report hash: \`${report.report_hash}\``,
    reportUrl ? `- Report URL: ${reportUrl}` : '',
    ``,
    `### Execution Path`,
    report.workflow?.summary || 'No execution path inferred.',
    ``,
    `### Evidence`,
    ...(report.evidence.length ? report.evidence.map((item) => `- ${item}`) : ['- No workflow evidence emitted.']),
  ];
  return lines.filter((line) => line !== '').join('\n');
}

export function reportToIssueTemplate(report: ExecutionPathReport, reportUrl?: string): string {
  return [
    `### PromptSonar Security Review`,
    ``,
    reportToMarkdown(report, reportUrl),
    ``,
    `### Expected Action`,
    `Review the execution path, confirm whether the privileged sink is intended, and apply least-privilege controls before merge.`,
  ].join('\n');
}

export function reportToPrComment(report: ExecutionPathReport, reportUrl?: string): string {
  return [
    `**PromptSonar Execution Path Review**`,
    ``,
    `Risk: **${report.workflow?.risk || 'none'}** | Confidence: **${report.confidence.score}% ${report.confidence.level}** | Findings: **${report.findings_summary.total}**`,
    report.workflow ? `Path: \`${report.workflow.summary}\`` : `Path: no execution path inferred.`,
    report.root_cause ? `Root cause: \`${report.root_cause.rule_id}\`` : `Root cause: none`,
    reportUrl ? `[Open public report](${reportUrl})` : '',
  ].filter(Boolean).join('\n');
}

export function reportToSarif(report: ExecutionPathReport): string {
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'PromptSonar',
          informationUri: 'https://github.com/meghal86/promptsonar',
          rules: report.findings_summary.top_rules.map((finding) => ({
            id: finding.rule_id,
            name: finding.rule_id,
            shortDescription: { text: `PromptSonar ${finding.rule_id}` },
            properties: {
              severity: finding.severity,
              category: finding.category || 'security',
            },
          })),
        },
      },
      results: report.findings_summary.top_rules.map((finding) => ({
        ruleId: finding.rule_id,
        level: finding.severity === 'critical' || finding.severity === 'high' ? 'error' : finding.severity === 'medium' ? 'warning' : 'note',
        message: { text: `Shared PromptSonar report finding ${finding.rule_id}.` },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: `report/${report.report_id}` },
          },
        }],
        properties: {
          report_hash: report.report_hash,
          workflow: report.workflow,
          workflow_diff: report.workflow_diff,
        },
      })),
    }],
  }, null, 2);
}

export function reportToJson(report: ExecutionPathReport): string {
  return JSON.stringify(report, null, 2);
}

export function assertReportContainsNoSensitiveText(report: ExecutionPathReport): boolean {
  const text = JSON.stringify(report);
  return !SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}
