import * as path from 'path';
import {
  auditMcpConfig,
  analyzeRepositoryExecutionFromFiles,
  evaluateRepositoryWithClosure,
  evaluatePrompt,
  InMemoryRepositorySource,
  NON_PRODUCTION_PROVENANCE,
  type Finding,
  type McpFinding,
  type RepositoryFileContent,
  type RepositoryExecutionReport,
  type RepositoryScanFinding,
  type RepositoryScanResult,
  type ScanBudget,
} from '@promptsonar/core';

export const REPORT_ROOT = '/uploaded-repository';

export type RepositoryUploadFile = {
  path: string;
  content: string;
};

export type RepositoryBatchScanDiagnostics = {
  filesReceived: number;
  filesWritten: number;
  filesSkipped: number;
  findingsCount: number;
  groupedFindingsCount: number;
  rawIssuesCount: number;
  reachablePathsCount: number;
  hiddenFindingsCount: number;
  hiddenReasons: Record<string, number>;
  mode: string;
  cli: string;
  closure?: boolean;
};

export type UploadedRepositoryReportOptions = {
  useClosure?: boolean;
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxBytes?: number;
  maxDurationMs?: number;
  maxReferenceDepth?: number;
};

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(part => part && part !== '..' && part !== '.').join('/');
}

function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (['.ts', '.tsx'].includes(ext)) return 'typescript';
  if (['.js', '.jsx'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.md' || ext === '.mdx') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  return 'text';
}

function locateEvidence(content: string, text?: string): { line: number; column: number; evidence: string } {
  const lines = content.split(/\r?\n/);
  const needle = text?.trim();
  if (needle) {
    const needleLine = needle.split(/\r?\n/)[0]?.trim();
    if (needleLine) {
      const index = lines.findIndex(line => line.includes(needleLine));
      if (index >= 0) {
        return {
          line: index + 1,
          column: Math.max(1, lines[index].indexOf(needleLine) + 1),
          evidence: lines[index].trim().slice(0, 220),
        };
      }
    }
  }
  const fallbackIndex = lines.findIndex(line => line.trim().length > 0);
  return {
    line: fallbackIndex >= 0 ? fallbackIndex + 1 : 1,
    column: 1,
    evidence: (lines[fallbackIndex] || text || '').trim().slice(0, 220),
  };
}

function mapFinding(content: string, finding: Finding): RepositoryScanFinding {
  const located = locateEvidence(content, finding.matchedText || finding.missingRequirement || finding.explanation);
  const evidenceKind = finding.evidenceKind || (finding.matchedText ? 'direct' : 'absence');
  return {
    rule_id: finding.rule_id,
    category: finding.category,
    severity: finding.severity,
    line: evidenceKind === 'absence' ? 1 : located.line,
    column: evidenceKind === 'absence' ? 1 : located.column,
    message: finding.explanation,
    fix: finding.suggested_fix || '',
    recommendation: finding.suggested_fix || '',
    evidence: evidenceKind === 'absence'
      ? (finding.missingRequirement || finding.explanation)
      : located.evidence,
    evidenceKind,
    scopeLabel: finding.scopeLabel,
    missingRequirement: finding.missingRequirement,
    confidence: finding.workflow?.confidence_level || finding.workflow?.path?.confidence_level || (evidenceKind === 'direct' ? 'HIGH' : 'MEDIUM'),
    why: finding.explanation,
    risk: finding.explanation,
    waived: false,
    workflow: finding.workflow,
  };
}

function mapMcpFinding(finding: McpFinding): RepositoryScanFinding {
  return {
    rule_id: finding.rule_id,
    category: 'security',
    severity: finding.severity,
    line: finding.line || 1,
    column: finding.column || 1,
    message: finding.message,
    fix: finding.fix,
    recommendation: finding.fix,
    evidence: finding.evidence || finding.path,
    evidenceKind: 'direct',
    confidence: 'HIGH',
    why: finding.message,
    risk: 'MCP configuration may expose tools, credentials, or execution capability beyond the agent workflow trust boundary.',
    waived: false,
    workflow: finding.workflow,
  };
}

function isMcpConfigPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const basename = path.basename(normalized);
  return normalized.endsWith('/mcp.json') ||
    normalized.endsWith('/mcp.yaml') ||
    normalized.endsWith('/mcp.yml') ||
    normalized === 'mcp.json' ||
    normalized === 'mcp.yaml' ||
    normalized === 'mcp.yml' ||
    normalized.endsWith('/.cursor/mcp.json') ||
    normalized.endsWith('/.vscode/mcp.json') ||
    basename === 'claude_desktop_config.json';
}

export function scanUploadedFiles(files: RepositoryUploadFile[]): RepositoryScanResult[] {
  const results: RepositoryScanResult[] = [];
  for (const file of files) {
    const filePath = path.join(REPORT_ROOT, file.path);
    const content = String(file.content || '');
    const findings: RepositoryScanFinding[] = [];

    if (isMcpConfigPath(file.path)) {
      try {
        findings.push(...auditMcpConfig(filePath, content).findings.map(mapMcpFinding));
      } catch {
        // Fall through to generic prompt/instruction rules.
      }
    }

    const ruleResult = evaluatePrompt({
      text: content,
      language: languageForPath(file.path),
      context: { filePath },
    });
    findings.push(...ruleResult.findings.map(finding => mapFinding(content, finding)));

    if (findings.length > 0) {
      results.push({ filePath, findings });
    }
  }
  return results;
}

function toRepositoryFileContent(files: RepositoryUploadFile[]): RepositoryFileContent[] {
  return files.map(file => {
    const content = String(file.content || '');
    return {
      path: normalizeRelativePath(file.path),
      size: Buffer.byteLength(content, 'utf-8'),
      content,
    };
  });
}

function dashboardClosureBudget(files: RepositoryUploadFile[], options: UploadedRepositoryReportOptions): ScanBudget {
  return {
    maxFiles: options.maxFiles ?? Math.max(1, files.length),
    maxBytes: options.maxBytes ?? files.reduce((total, file) => total + Buffer.byteLength(String(file.content || ''), 'utf-8'), 0),
    maxCharacters: options.maxFileSizeBytes,
    maxDurationMs: options.maxDurationMs ?? 50_000,
    maxReferenceDepth: options.maxReferenceDepth ?? 2,
  };
}

export async function buildUploadedRepositoryReport(
  files: RepositoryUploadFile[],
  options: UploadedRepositoryReportOptions = {},
): Promise<{ report: RepositoryExecutionReport; scanResults: RepositoryScanResult[] }> {
  if (options.useClosure) {
    const closure = await evaluateRepositoryWithClosure({
      rootPath: REPORT_ROOT,
      source: new InMemoryRepositorySource(toRepositoryFileContent(files)),
      budget: dashboardClosureBudget(files, options),
      mode: 'bounded',
      profileEvidence: { signals: [] },
    });
    return { report: closure.report, scanResults: closure.report.findings };
  }

  const scanResults = scanUploadedFiles(files);
  const report = analyzeRepositoryExecutionFromFiles(
    REPORT_ROOT,
    files,
    scanResults as any,
    {
      maxFiles: options.maxFiles,
      maxFileSizeBytes: options.maxFileSizeBytes,
    },
  );
  return { report, scanResults };
}

export function buildRepositoryBatchScanDiagnostics({
  filesReceived,
  filesWritten,
  filesSkipped,
  scanResults,
  report,
  useClosure = false,
}: {
  filesReceived: number;
  filesWritten: number;
  filesSkipped: number;
  scanResults: Array<{ findings?: unknown[] }>;
  report: RepositoryExecutionReport;
  useClosure?: boolean;
}): RepositoryBatchScanDiagnostics {
  const hiddenReasons = Object.fromEntries(
    Object.entries(report.summary.issuesByProvenance || {}).filter(([provenance]) =>
      NON_PRODUCTION_PROVENANCE.has(provenance as any),
    ),
  );

  const diagnostics: RepositoryBatchScanDiagnostics = {
    filesReceived,
    filesWritten,
    filesSkipped,
    findingsCount: scanResults.reduce((total, result) => total + (result.findings?.length || 0), 0),
    groupedFindingsCount: new Set(report.issues.map(issue => issue.ruleId)).size,
    rawIssuesCount: report.issues.length,
    reachablePathsCount: report.reachablePaths.length,
    hiddenFindingsCount: Math.max(0, report.issues.length - (report.summary.productionIssueSummary?.total || 0)),
    hiddenReasons,
    mode: 'browser-batched',
    cli: 'npx @promptsonar/cli repo . --json --output repository-report.json',
  };
  if (useClosure) diagnostics.closure = true;
  return diagnostics;
}
