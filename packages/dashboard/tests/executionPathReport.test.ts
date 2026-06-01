import { describe, expect, it } from 'vitest';
import {
  assertReportContainsNoSensitiveText,
  createExecutionPathReport,
  createReportHash,
  createReportUrl,
  decodeReportPayload,
  encodeReportPayload,
  reportToJson,
  reportToMarkdown,
  reportToPrComment,
  reportToSarif,
  verifyExecutionPathReport,
} from '../src/lib/reports/executionPathReport';

const workflow = {
  source: 'user_input',
  sink: 'shell_execution',
  trustBoundary: 'untrusted_or_semitrusted_to_trusted_or_privileged',
  risk: 'critical',
  recommendation: 'Require approval before shell execution.',
  confidence: 'high',
  confidence_score: 92,
  confidence_level: 'HIGH',
  workflow_evidence: ['shell_exec detected', 'api_key=[REDACTED]'],
  path: {
    nodes: [
      { id: 'user_input', label: 'user_input', type: 'user_input', trust: 'untrusted', confidence: 'high' },
      { id: 'tool_router', label: 'tool_router', type: 'tool_router', trust: 'trusted', confidence: 'medium' },
      { id: 'shell_execution', label: 'shell_execution', type: 'shell_execution', trust: 'privileged', confidence: 'high' },
    ],
    edges: [
      { from: 'user_input', to: 'tool_router', type: 'tool_call', risk: 'critical', reason: 'user_input can influence tool_router.' },
      { from: 'tool_router', to: 'shell_execution', type: 'execution_flow', risk: 'critical', reason: 'tool_router can influence shell_execution.' },
    ],
    summary: 'user_input -> tool_router -> shell_execution',
    risk: 'critical',
    trustBoundaryCrossed: true,
    privilegedSinkReached: true,
    recommendation: 'Require approval before shell execution.',
    confidence: 'high',
    confidence_score: 92,
    confidence_level: 'HIGH',
    workflow_evidence: ['shell_exec detected', 'api_key=[REDACTED]'],
    workflow_diff: {
      workflowDiffVersion: '1.0',
      before: { nodes: [], edges: [], risk: 'critical', riskScore: 95, privilegedSinkReached: true, trustBoundaryCrossed: true },
      after: { nodes: [], edges: [], risk: 'low', riskScore: 10, privilegedSinkReached: false, trustBoundaryCrossed: false },
      removedNodes: ['shell_execution'],
      addedNodes: ['response'],
      removedEdges: ['tool_router -> shell_execution'],
      addedEdges: [],
      riskReduction: 89,
      beforeRisk: 95,
      afterRisk: 10,
      executionPathRemoved: true,
      diffReason: 'privileged_sink_removed',
      comparison: {
        nodes: { removed: ['shell_execution'], added: ['response'] },
        edges: { removed: ['tool_router -> shell_execution'], added: [] },
        privilegedSinks: { removed: ['shell_execution'], added: [] },
        trustBoundaries: { before: true, after: false, removed: true },
        permissions: { removed: [], added: [] },
      },
    },
  },
  workflow_diff: {
    workflowDiffVersion: '1.0',
    before: { nodes: [], edges: [], risk: 'critical', riskScore: 95, privilegedSinkReached: true, trustBoundaryCrossed: true },
    after: { nodes: [], edges: [], risk: 'low', riskScore: 10, privilegedSinkReached: false, trustBoundaryCrossed: false },
    removedNodes: ['shell_execution'],
    addedNodes: ['response'],
    removedEdges: ['tool_router -> shell_execution'],
    addedEdges: [],
    riskReduction: 89,
    beforeRisk: 95,
    afterRisk: 10,
    executionPathRemoved: true,
    diffReason: 'privileged_sink_removed',
    comparison: {
      nodes: { removed: ['shell_execution'], added: ['response'] },
      edges: { removed: ['tool_router -> shell_execution'], added: [] },
      privilegedSinks: { removed: ['shell_execution'], added: [] },
      trustBoundaries: { before: true, after: false, removed: true },
      permissions: { removed: [], added: [] },
    },
  },
} as any;

describe('execution path report serialization', () => {
  it('serializes sanitized reports without raw prompt or secrets', () => {
    const report = createExecutionPathReport({
      score: 39,
      status: 'fail',
      generatedAt: '2026-06-01T00:00:00.000Z',
      findings: [{
        rule_id: 'sec_workflow_escalation',
        category: 'security',
        severity: 'critical',
        explanation: 'Workflow reaches shell execution with password=[REDACTED].',
        suggested_fix: 'Require approval.',
        workflow,
      }],
      mcpRiskScore: { score: 90, level: 'CRITICAL' },
    });

    expect(report.report_version).toBe('1.0');
    expect(report.workflow?.summary).toBe('user_input -> tool_router -> shell_execution');
    expect(report.workflow_diff_version).toBe('1.0');
    expect(report.workflow_diff?.execution_path_removed).toBe(true);
    expect(report.mcp_risk_score?.score).toBe(90);
    expect(JSON.stringify(report)).not.toContain('sk-proj');
    expect(assertReportContainsNoSensitiveText(report)).toBe(true);
  });

  it('generates deterministic hashes and verifies report integrity', () => {
    const report = createExecutionPathReport({
      generatedAt: '2026-06-01T00:00:00.000Z',
      findings: [{ rule_id: 'sec_workflow_escalation', category: 'security', severity: 'critical', workflow }],
    });
    const { report_hash, report_id, ...withoutHash } = report;

    expect(createReportHash(withoutHash)).toBe(report_hash);
    expect(report_id).toBe(report_hash.slice(0, 16));
    expect(verifyExecutionPathReport(report)).toBe(true);
    expect(verifyExecutionPathReport({ ...report, findings_summary: { ...report.findings_summary, total: 99 } })).toBe(false);
  });

  it('round-trips shareable payloads and URLs', () => {
    const report = createExecutionPathReport({
      generatedAt: '2026-06-01T00:00:00.000Z',
      findings: [{ rule_id: 'sec_workflow_escalation', category: 'security', severity: 'critical', workflow }],
    });
    const payload = encodeReportPayload(report);
    const decoded = decodeReportPayload(payload);
    const url = createReportUrl('https://promptsonar.local/', report);

    expect(decoded.report_hash).toBe(report.report_hash);
    expect(url).toContain(`/report/${report.report_id}?payload=`);
    expect(url).not.toContain('shell_exec detected');
  });

  it('exports JSON, SARIF, Markdown, and PR comments', () => {
    const report = createExecutionPathReport({
      generatedAt: '2026-06-01T00:00:00.000Z',
      findings: [{ rule_id: 'sec_workflow_escalation', category: 'security', severity: 'critical', workflow }],
    });

    expect(JSON.parse(reportToJson(report)).report_hash).toBe(report.report_hash);
    expect(JSON.parse(reportToSarif(report)).version).toBe('2.1.0');
    expect(reportToMarkdown(report)).toContain('PromptSonar Execution Path Report');
    expect(reportToPrComment(report)).toContain('Execution Path Review');
  });
});
