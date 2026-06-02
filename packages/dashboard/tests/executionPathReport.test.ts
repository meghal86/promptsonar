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
  workflow_replay: {
    replay_version: '1.0',
    generated_from: 'workflow_graph',
    timeline: ['USER_INPUT', 'TOOL_ROUTER', 'SHELL'],
    risk_evolution: ['SAFE', 'REVIEW', 'DANGEROUS'],
    events: [
      {
        index: 1,
        timestamp: 'T+00:00:00.000',
        type: 'USER_INPUT',
        nodeId: 'user_input',
        nodeType: 'user_input',
        label: 'user_input',
        trust: 'untrusted',
        confidence: 'high',
        confidenceContribution: 5,
        trustBoundaryCrossed: false,
        riskBefore: 'SAFE',
        riskAfter: 'SAFE',
        riskTransition: 'SAFE->SAFE',
        reason: 'user input enters workflow',
        matchedRules: ['sec_workflow_escalation'],
        provenance: [{ ruleId: 'sec_workflow_escalation', label: 'heuristic match', source: 'api_key=sk-proj-secretsecret', severity: 'critical' }],
      },
      {
        index: 2,
        timestamp: 'T+00:00:01.000',
        type: 'TOOL_ROUTER',
        nodeId: 'tool_router',
        nodeType: 'tool_router',
        label: 'tool_router',
        trust: 'trusted',
        confidence: 'medium',
        confidenceContribution: 10,
        trustBoundaryCrossed: true,
        riskBefore: 'SAFE',
        riskAfter: 'REVIEW',
        riskTransition: 'SAFE->REVIEW',
        reason: 'tool router selected',
        matchedRules: ['tool_routing'],
        provenance: [{ ruleId: 'sec_workflow_escalation', label: 'tool routing', source: 'tool_router', severity: 'critical' }],
      },
      {
        index: 3,
        timestamp: 'T+00:00:02.000',
        type: 'SHELL',
        nodeId: 'shell_execution',
        nodeType: 'shell_execution',
        label: 'shell_execution',
        trust: 'privileged',
        confidence: 'high',
        confidenceContribution: 40,
        trustBoundaryCrossed: false,
        riskBefore: 'REVIEW',
        riskAfter: 'DANGEROUS',
        riskTransition: 'REVIEW->DANGEROUS',
        reason: 'shell execution reached',
        matchedRules: ['shell_command'],
        provenance: [{ ruleId: 'sec_workflow_escalation', label: 'shell command detected', source: 'shell_exec', severity: 'critical' }],
      },
    ],
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
    expect(report.verdict).toBe('CRITICAL');
    expect(report.execution_risk).toBe(95);
    expect(report.privileged_sink).toBe('Shell Execution');
    expect(report.workflow?.summary).toBe('user_input -> tool_router -> shell_execution');
    expect(report.workflow_diff_version).toBe('1.0');
    expect(report.workflow_diff?.execution_path_removed).toBe(true);
    expect(report.workflow_diff?.before_path).toEqual([]);
    expect(report.workflow_diff?.after_path).toEqual([]);
    expect(report.workflow_replay?.replay_version).toBe('1.0');
    expect(report.workflow_replay?.events.map(event => event.type)).toEqual(['USER_INPUT', 'TOOL_ROUTER', 'SHELL']);
    expect(report.evidence_items.map(item => item.finding_rule_id)).toContain('sec_workflow_escalation');
    expect(report.confidence.reasons).toContain('Privileged sink reached');
    expect(report.recommended_fixes).toEqual([{
      finding_rule_id: 'sec_workflow_escalation',
      severity: 'critical',
      fix: 'Require approval.',
    }]);
    expect(JSON.stringify(report.workflow_replay)).not.toContain('sk-proj-secretsecret');
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
    expect(reportToMarkdown(report)).toContain('PromptSonar Execution Path Review');
    expect(reportToMarkdown(report)).toContain('Recommended Fixes');
    expect(reportToMarkdown(report)).toContain('Workflow Replay');
    expect(reportToPrComment(report)).toContain('Execution Path Review');
    expect(reportToPrComment(report)).toContain('Execution risk');
  });
});
