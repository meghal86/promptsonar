import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { createRequire } from 'module';
import { analyzeRepositoryExecution, type RepositoryExecutionReport } from '@promptsonar/core';
import { scanFiles } from '@promptsonar/cli';
import { cacheRepositoryReport, repositoryReportCache } from '@/lib/repositoryReportCache';

const MAX_FILES = 200;
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 1_000_000;
const SCAN_TIMEOUT_MS = 110_000;
const IGNORED_PARTS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);

// Serverless (Vercel/Lambda) can't reliably spawn a child process and caps wall
// time, so on those platforms we run in-process and keep our timeout under the
// platform limit. `maxDuration` raises Vercel's function budget (plan-permitting).
export const runtime = 'nodejs';
export const maxDuration = 60;
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.AWS_REGION;
const SERVERLESS_TIMEOUT_MS = 55_000;

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

// Resolve the built CLI entry so the scan can run in a separate, killable process.
function resolveCliBin(): string | null {
  try {
    const req = createRequire(__filename);
    const pkgPath = req.resolve('@promptsonar/cli/package.json');
    return path.join(path.dirname(pkgPath), 'dist', 'cli.js');
  } catch {
    return null;
  }
}

// Run the scan in a child process with a hard kill timeout. Unlike an in-process
// Promise.race (which cannot interrupt synchronous CPU-bound work), this is
// guaranteed to terminate — a runaway analysis is force-killed, not left hanging.
// Returns the parsed report, or throws { timedOut } / a spawn error.
function scanInChildProcess(cliBin: string, root: string): Promise<RepositoryExecutionReport> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliBin, 'repo', root, '--json'],
      { timeout: SCAN_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true || (error as any).signal === 'SIGKILL';
          reject(Object.assign(new Error(error.message), { timedOut, spawnFailed: (error as NodeJS.ErrnoException).code === 'ENOENT' }));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as RepositoryExecutionReport);
        } catch (parseError: any) {
          reject(Object.assign(new Error(`Could not parse scan output: ${parseError?.message || parseError}`), { spawnFailed: true }));
        }
      },
    );
  });
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

    const scanStartedAt = performance.now();
    let report: RepositoryExecutionReport | undefined;

    // Preferred path (long-running servers / local dev): run the scan in a
    // force-killable child process so a runaway (e.g. pathological file) is
    // terminated within the deadline instead of hanging. Skipped on serverless,
    // where spawning a process is unreliable and the CLI isn't bundled.
    const cliBin = IS_SERVERLESS ? null : resolveCliBin();
    if (cliBin && fs.existsSync(cliBin)) {
      try {
        report = await scanInChildProcess(cliBin, root);
      } catch (childError: any) {
        if (childError?.timedOut) {
          return NextResponse.json({
            error: `Scan exceeded ${SCAN_TIMEOUT_MS / 1000}s and was stopped. This repository is too large or contains a file that is slow to parse — run the full scan locally with the CLI: npx @promptsonar/cli repo .`,
          }, { status: 503 });
        }
        // Spawn/parse failure (not a timeout): fall through to the in-process scan.
        report = undefined;
      }
    }

    // In-process scan — the only option on serverless, and the fallback when the
    // child process can't run. On serverless we race the (async) scanner against
    // the platform budget so we return a clear error instead of a 504.
    if (!report) {
      const runScan = (async () => {
        const scanResults = await scanFiles(root!, {});
        return analyzeRepositoryExecution(root!, scanResults as any);
      })();
      if (IS_SERVERLESS) {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('serverless-timeout'), { serverlessTimeout: true })), SERVERLESS_TIMEOUT_MS),
        );
        report = await Promise.race([runScan, timeout]);
      } else {
        report = await runScan;
      }
    }

    const scanMs = performance.now() - scanStartedAt;
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
          scannerMs: Math.round(scanMs),
          reportMs: 0,
          totalMs: Math.round(performance.now() - requestStartedAt),
        },
      },
    });
  } catch (err: any) {
    if (err?.serverlessTimeout) {
      return NextResponse.json({
        error: `This scan is too large for the hosted (serverless) scanner, which has a strict time limit. Try fewer files, or run the full scan locally with the CLI — it has no size limit: npx @promptsonar/cli repo .`,
      }, { status: 503 });
    }
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
