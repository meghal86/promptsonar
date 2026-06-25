import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeRepositoryExecutionFromFiles, type RepositoryExecutionReport, type RepositoryScanResult } from '@promptsonar/core';
import { scanFiles, type ScanResult } from '@promptsonar/cli';
import { cacheRepositoryReport } from '@/lib/repositoryReportCache';
import {
  buildRepositoryBatchScanDiagnostics,
  buildUploadedRepositoryReport,
  normalizeRelativePath,
  REPORT_ROOT,
  scanUploadedFiles,
  type RepositoryUploadFile,
} from '@/lib/repositoryBatchScan';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILES = 200;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 1_000_000;
const MAX_BATCH_FILES = 25;
const IGNORED_PARTS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

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

export async function POST(request: Request) {
  let root: string | undefined;
  try {
    const body = await request.json();
    const action = body?.action;
    const useClosure = body?.useClosure === true;
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
      let scanResults: RepositoryScanResult[];
      let report: RepositoryExecutionReport;
      if (useClosure) {
        const closureReport = await buildUploadedRepositoryReport(bounded.files, {
          useClosure: true,
          maxFiles: MAX_FILES,
          maxFileSizeBytes: MAX_FILE_CHARS,
          maxBytes: MAX_TOTAL_CHARS,
        });
        report = closureReport.report;
        scanResults = closureReport.scanResults;
      } else {
        scanResults = Array.isArray(body?.scanResults)
          ? (body.scanResults as ScanResult[]).map(reportScanResult) as unknown as RepositoryScanResult[]
          : scanUploadedFiles(bounded.files);
        report = analyzeRepositoryExecutionFromFiles(
          REPORT_ROOT,
          bounded.files,
          scanResults as any,
          { maxFiles: MAX_FILES, maxFileSizeBytes: MAX_FILE_CHARS },
        );
      }
      report.scanMode = 'browser-bounded';
      report.repository = {
        ...report.repository,
        name: body?.repositoryName || 'Uploaded repository',
      };
      cacheRepositoryReport(report);

      return NextResponse.json({
        report,
        scan: buildRepositoryBatchScanDiagnostics({
          filesReceived: files.length,
          filesWritten: bounded.files.length,
          filesSkipped: bounded.skipped,
          scanResults,
          report,
          useClosure,
        }),
      });
    }

    return NextResponse.json({ error: 'Unsupported repository batch action.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Repository batch scan failed' }, { status: 500 });
  } finally {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}
