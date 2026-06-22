import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  analyzeRepositoryExecutionFromFiles,
  auditMcpConfig,
  evaluatePrompt,
  NON_PRODUCTION_PROVENANCE,
  type Finding,
  type McpFinding,
  type RepositoryExecutionReport,
  type RepositoryScanFinding,
  type RepositoryScanResult,
} from '@promptsonar/core';
import { scanFiles, type ScanResult } from '@promptsonar/cli';
import { cacheRepositoryReport } from '@/lib/repositoryReportCache';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILES = 200;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 1_000_000;
const MAX_BATCH_FILES = 25;
const ROOT_NAME = 'uploaded-repository';
const REPORT_ROOT = `/${ROOT_NAME}`;
const IGNORED_PARTS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

type RepositoryUploadFile = {
  path: string;
  content: string;
};

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').split('/').filter(part => part && part !== '..' && part !== '.').join('/');
}

function shouldIgnore(relativePath: string): boolean {
  return normalizeRelativePath(relativePath).split('/').some(part => IGNORED_PARTS.has(part));
}

function validateFiles(files: RepositoryUploadFile[], maxFiles: number): string | undefined {
  if (!Array.isArray(files) || files.length === 0) return 'files must be a non-empty array';
  if (files.length > maxFiles) return `This request accepts at most ${maxFiles} files.`;
  const submittedChars = files.reduce((total, file) => total + String(file.content || '').length, 0);
  if (submittedChars > MAX_TOTAL_CHARS) {
    return `Browser repository scans accept at most ${MAX_TOTAL_CHARS.toLocaleString()} characters. Use the local CLI for larger scans.`;
  }
  return undefined;
}

function boundedFiles(files: RepositoryUploadFile[]): { files: RepositoryUploadFile[]; skipped: number } {
  const bounded: RepositoryUploadFile[] = [];
  let totalChars = 0;
  let skipped = 0;

  for (const file of files.slice(0, MAX_FILES)) {
    const relativePath = normalizeRelativePath(file.path);
    if (!relativePath || shouldIgnore(relativePath)) {
      skipped += 1;
      continue;
    }
    const content = String(file.content || '').slice(0, MAX_FILE_CHARS);
    if (totalChars + content.length > MAX_TOTAL_CHARS) {
      skipped += 1;
      continue;
    }
    bounded.push({ path: relativePath, content });
    totalChars += content.length;
  }

  return { files: bounded, skipped: skipped + Math.max(0, files.length - MAX_FILES) };
}

function writeUploadedRepo(files: RepositoryUploadFile[]): { root: string; written: RepositoryUploadFile[]; skipped: number } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-repository-batch-'));
  const written: RepositoryUploadFile[] = [];
  const bounded = boundedFiles(files);

  for (const file of bounded.files) {
    const fullPath = path.join(root, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, 'utf-8');
    written.push(file);
  }

  return { root, written, skipped: bounded.skipped };
}

function normalizeScanResult(root: string, result: ScanResult): ScanResult {
  const relativePath = normalizeRelativePath(path.relative(root, result.filePath));
  return {
    ...result,
    filePath: relativePath || normalizeRelativePath(result.filePath),
  };
}

function reportScanResult(result: ScanResult): ScanResult {
  const relativePath = normalizeRelativePath(result.filePath);
  return {
    ...result,
    filePath: path.join(REPORT_ROOT, relativePath),
  };
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

function mapFinding(filePath: string, content: string, finding: Finding): RepositoryScanFinding {
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

function scanUploadedFiles(files: RepositoryUploadFile[]): RepositoryScanResult[] {
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
    findings.push(...ruleResult.findings.map(finding => mapFinding(filePath, content, finding)));

    if (findings.length > 0) {
      results.push({ filePath, findings });
    }
  }
  return results;
}

export async function POST(request: Request) {
  let root: string | undefined;
  try {
    const body = await request.json();
    const action = body?.action;
    const files = Array.isArray(body?.files) ? body.files as RepositoryUploadFile[] : [];

    if (action === 'scan') {
      const validationError = validateFiles(files, MAX_BATCH_FILES);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

      const upload = writeUploadedRepo(files);
      root = upload.root;
      const results = (await scanFiles(root, {
        maxFiles: MAX_BATCH_FILES,
        maxFileSizeBytes: MAX_FILE_CHARS,
      })).map(result => normalizeScanResult(root!, result));

      return NextResponse.json({
        results,
        scan: {
          filesReceived: files.length,
          filesWritten: upload.written.length,
          filesSkipped: upload.skipped,
        },
      });
    }

    if (action === 'report') {
      const validationError = validateFiles(files, MAX_FILES);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      const bounded = boundedFiles(files);
      const scanResults = Array.isArray(body?.scanResults)
        ? (body.scanResults as ScanResult[]).map(reportScanResult)
        : scanUploadedFiles(bounded.files);
      const report: RepositoryExecutionReport = analyzeRepositoryExecutionFromFiles(
        REPORT_ROOT,
        bounded.files,
        scanResults as any,
        { maxFiles: MAX_FILES, maxFileSizeBytes: MAX_FILE_CHARS },
      );
      report.scanMode = 'browser-bounded';
      report.repository = {
        ...report.repository,
        name: body?.repositoryName || 'Uploaded repository',
      };
      const hiddenReasons = Object.fromEntries(
        Object.entries(report.summary.issuesByProvenance || {}).filter(([provenance]) =>
          NON_PRODUCTION_PROVENANCE.has(provenance as any),
        ),
      );
      cacheRepositoryReport(report);

      return NextResponse.json({
        report,
        scan: {
          filesReceived: files.length,
          filesWritten: bounded.files.length,
          filesSkipped: bounded.skipped,
          findingsCount: scanResults.reduce((total: number, result: any) => total + (result.findings?.length || 0), 0),
          groupedFindingsCount: new Set(report.issues.map(issue => issue.ruleId)).size,
          rawIssuesCount: report.issues.length,
          reachablePathsCount: report.reachablePaths.length,
          hiddenFindingsCount: Math.max(0, report.issues.length - (report.summary.productionIssueSummary?.total || 0)),
          hiddenReasons,
          mode: 'browser-batched',
          cli: 'npx @promptsonar/cli repo . --json --output repository-report.json',
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported repository batch action.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Repository batch scan failed' }, { status: 500 });
  } finally {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}
