import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeRepositoryExecution, evaluatePrompt } from '@promptsonar/core';

const MAX_FILES = 700;
const MAX_FILE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 4_000_000;
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
  try {
    const body = await request.json();
    const files = Array.isArray(body?.files) ? body.files as RepositoryUploadFile[] : [];
    if (files.length === 0) {
      return NextResponse.json({ error: 'files must be a non-empty array' }, { status: 400 });
    }

    const { root, written, skipped } = writeUploadedRepo(files);
    const scanResults = written.map(file => {
      const fullPath = path.join(root, file.path);
      const result = evaluatePrompt({
        text: file.content,
        context: { filePath: fullPath },
      });
      return {
        filePath: fullPath,
        findings: (result.findings || []).map((finding: any) => ({
          ...finding,
          message: finding.explanation || finding.message || finding.rule_id,
          fix: finding.suggested_fix || finding.fix,
          evidence: finding.matchedText || finding.evidence,
        })),
      };
    });

    const report = analyzeRepositoryExecution(root, scanResults as any);
    report.scanMode = 'browser-bounded';
    report.repository = {
      ...report.repository,
      name: body?.repositoryName || 'Uploaded repository',
    };

    return NextResponse.json({
      report,
      scan: {
        filesReceived: files.length,
        filesWritten: written.length,
        filesSkipped: skipped,
        mode: 'browser-bounded',
        cli: 'npx @promptsonar/cli repo . --json --output repository-report.json',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Repository analysis failed' }, { status: 500 });
  }
}
