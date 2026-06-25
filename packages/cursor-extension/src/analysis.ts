import {
  auditMcpConfig,
  evaluatePrompt,
  formatToSarif,
  normalizeMcpAuditResultContextual,
  type Finding,
  type McpAuditResult,
} from '@promptsonar/core';
import {
  applyAllFixes,
  isMcpConfigFile,
  isPromptFile,
  isScannable,
  pickWorstWorkflowFinding,
  reportText,
  workflowDiffReportBetween,
} from './shared';

export const CURSOR_COMMANDS = [
  'promptsonar.cursor.scanCurrentFile',
  'promptsonar.cursor.openExecutionPath',
  'promptsonar.cursor.showWorkflowReplay',
  'promptsonar.cursor.showWorkflowDiff',
  'promptsonar.cursor.applyFixAndShowWorkflowDiff',
  'promptsonar.cursor.exportSarif',
  'promptsonar.cursor.copyReport',
  'promptsonar.cursor.openPlayground',
] as const;

export type CursorCommand = typeof CURSOR_COMMANDS[number];

export interface CursorAnalysisOptions {
  maxFileSizeBytes?: number;
}

export interface CursorAnalysisResult {
  skipped?: string;
  findings: Finding[];
  mcpAudit?: McpAuditResult;
  score: number;
  status: 'pass' | 'warn' | 'fail';
  report: string;
}

export interface CursorDiagnostic {
  ruleId: string;
  severity: 'error' | 'warning' | 'information';
  message: string;
  start: number;
  end: number;
}

export function isCursorSupportedFile(filePath: string, content?: string): boolean {
  return isScannable(filePath, content);
}

function scoreFindings(findings: Finding[]): number {
  if (findings.some((finding) => finding.severity === 'critical')) return 40;
  if (findings.some((finding) => finding.severity === 'high')) return 65;
  if (findings.length > 0) return 80;
  return 100;
}

function statusFromScore(score: number): CursorAnalysisResult['status'] {
  if (score < 70) return 'fail';
  if (score < 85) return 'warn';
  return 'pass';
}

function mcpFindings(mcpAudit: McpAuditResult): Finding[] {
  return mcpAudit.findings.map((finding) => ({
    rule_id: finding.rule_id,
    category: 'security',
    severity: finding.severity,
    explanation: finding.message,
    suggested_fix: finding.fix,
    workflow: finding.workflow,
    matchedText: finding.evidence,
    context: finding.context,
  }));
}

export function analyzeCursorDocument(
  filePath: string,
  content: string,
  options: CursorAnalysisOptions = {},
): CursorAnalysisResult {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 1048576;
  if (!isCursorSupportedFile(filePath, content)) {
    return {
      skipped: 'unsupported_file',
      findings: [],
      score: 100,
      status: 'pass',
      report: 'PromptSonar Cursor: unsupported file.',
    };
  }
  if (Buffer.byteLength(content, 'utf8') > maxFileSizeBytes) {
    return {
      skipped: 'file_too_large',
      findings: [],
      score: 100,
      status: 'pass',
      report: `PromptSonar Cursor: skipped files larger than ${maxFileSizeBytes} bytes.`,
    };
  }

  let findings: Finding[] = [];
  let mcpAudit: McpAuditResult | undefined;
  if (isMcpConfigFile(filePath)) {
    mcpAudit = normalizeMcpAuditResultContextual(auditMcpConfig(filePath, content));
    findings = mcpFindings(mcpAudit);
  } else if (isPromptFile(filePath, content)) {
    findings = evaluatePrompt({ text: content, context: { filePath } }).findings;
  }

  const score = scoreFindings(findings);
  return {
    findings,
    mcpAudit,
    score,
    status: statusFromScore(score),
    report: reportText(findings, mcpAudit, filePath),
  };
}

function diagnosticSeverity(severity: Finding['severity']): CursorDiagnostic['severity'] {
  if (severity === 'critical' || severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'information';
}

export function cursorDiagnosticsForFindings(findings: Finding[], contentLength: number): CursorDiagnostic[] {
  return findings.map((finding) => ({
    ruleId: finding.rule_id,
    severity: diagnosticSeverity(finding.severity),
    message: finding.explanation || finding.rule_id,
    start: 0,
    end: Math.max(1, contentLength),
  }));
}

export function applyCursorFixAndDiff(filePath: string, content: string): {
  fixed: string;
  changed: boolean;
  diffReport: string;
} {
  const before = analyzeCursorDocument(filePath, content);
  const fixed = applyAllFixes(content);
  const after = fixed === content ? undefined : analyzeCursorDocument(filePath, fixed);
  return {
    fixed,
    changed: fixed !== content,
    diffReport: workflowDiffReportBetween(
      pickWorstWorkflowFinding(before.findings)?.workflow,
      after ? pickWorstWorkflowFinding(after.findings)?.workflow : undefined,
    ),
  };
}

export function cursorSarif(filePath: string, result: CursorAnalysisResult): string {
  const findings = result.findings.map((finding) => ({
    ...finding,
    filePath,
    line: 1,
    column: 1,
  }));
  return formatToSarif(findings, filePath);
}
