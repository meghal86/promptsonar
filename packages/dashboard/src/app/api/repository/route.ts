import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeRepositoryExecution, type RepositoryExecutionReport } from '@promptsonar/core';
import { scanFiles } from '@promptsonar/cli';
import { cacheRepositoryReport, repositoryReportCache } from '@/lib/repositoryReportCache';

const MAX_FILES = 200;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 1_000_000;
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

function writeUploadedRepo(files: RepositoryUploadFile[]): { root: string; written: RepositoryUploadFile[]; skipped: number } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-repository-'));
  const written: RepositoryUploadFile[] = [];
  let skipped = 0;
  let totalChars = 0;

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
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    written.push({ path: relativePath, content });
    totalChars += content.length;
  }

  return { root, written, skipped: skipped + Math.max(0, files.length - MAX_FILES) };
}

export async function POST(request: Request) {
  let root: string | undefined;
  const requestStartedAt = performance.now();
  try {
    const body = await request.json();
    const files = Array.isArray(body?.files) ? body.files as RepositoryUploadFile[] : [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'files must be a non-empty array' }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({
        error: `Browser repository scans accept at most ${MAX_FILES} prioritized files. Use the local CLI for larger scans.`,
      }, { status: 413 });
    }
    const submittedChars = files.reduce((total, file) => total + String(file.content || '').length, 0);
    if (submittedChars > MAX_TOTAL_CHARS) {
      return NextResponse.json({
        error: `Browser repository scans accept at most ${MAX_TOTAL_CHARS.toLocaleString()} characters. Use the local CLI for larger scans.`,
      }, { status: 413 });
    }

    const upload = writeUploadedRepo(files);
    root = upload.root;
    const { written, skipped } = upload;
    // Use the same scanner pipeline as the CLI (prompt extraction + MCP audit
    // + dedupe + evidence locations) so Web and CLI report identical issues
    // for the same input.
    const scannerStartedAt = performance.now();
    const scanResults = await scanFiles(root, {});
    const scannerMs = performance.now() - scannerStartedAt;

    const reportStartedAt = performance.now();
    const report = analyzeRepositoryExecution(root, scanResults as any);
    const reportMs = performance.now() - reportStartedAt;
    report.scanMode = 'browser-bounded';
    report.repository = {
      ...report.repository,
      name: body?.repositoryName || 'Uploaded repository',
    };
    cacheRepositoryReport(report);

    return NextResponse.json({
      report,
      scan: {
        filesReceived: files.length,
        filesWritten: written.length,
        filesSkipped: skipped,
        mode: 'browser-bounded',
        cli: 'npx @promptsonar/cli repo . --json --output repository-report.json',
        timings: {
          scannerMs: Math.round(scannerMs),
          reportMs: Math.round(reportMs),
          totalMs: Math.round(performance.now() - requestStartedAt),
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Repository analysis failed' }, { status: 500 });
  } finally {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function GET(request: Request) {
  const scanId = new URL(request.url).searchParams.get('scanId');
  if (!scanId) {
    return NextResponse.json({ error: 'scanId is required' }, { status: 400 });
  }
  const report = repositoryReportCache.get(scanId);
  if (!report) {
    return NextResponse.json({ error: 'Preview scan not found or expired' }, { status: 404 });
  }
  return NextResponse.json({ report });
}
