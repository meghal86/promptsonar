import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Fixers are imported from the dashboard's own (pure) copy so a stale prebuilt
// @promptsonar/core can never break this route. scanFiles (for the optional
// re-scan verification) still comes from the CLI and degrades gracefully.
import { computeDeterministicEdits, applyDeterministicFixes } from '@/lib/deterministicFixers';

const MAX_FILE_CHARS = 200_000;

// Keep the file's real relative path (minus traversal) so the scanner recognizes
// its type — e.g. an MCP audit only fires for `.cursor/mcp.json`, not a renamed temp file.
function safeRelativePath(value: string): string {
  const parts = value.replace(/\\/g, '/').split('/').filter((p) => p && p !== '..' && p !== '.');
  const cleaned = parts.map((p) => p.replace(/[^a-zA-Z0-9_.-]/g, '_')).join('/');
  return cleaned || 'file.txt';
}

function writeAndScanRoot(content: string, relativePath: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-fix-'));
  const full = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return dir;
}

// Deterministic, no-AI fix for a single file, verified by re-scanning the result
// with the same engine. Returns the exact edits, the fixed content, and the
// finding delta so the UI can show a provable "before -> after".
export async function POST(request: Request) {
  const tmpDirs: string[] = [];
  try {
    const body = await request.json();
    const filePath = typeof body?.path === 'string' && body.path ? body.path : 'file.txt';
    const content = typeof body?.content === 'string' ? body.content.slice(0, MAX_FILE_CHARS) : '';
    if (!content) {
      return NextResponse.json({ error: 'content must be a non-empty string' }, { status: 400 });
    }

    const edits = computeDeterministicEdits(filePath, content);
    const { fixed, applied, residualClear } = applyDeterministicFixes(filePath, content, edits);

    let beforeCount: number | null = null;
    let afterCount: number | null = null;
    if (applied.length > 0 && fixed !== content) {
      // Optional proof: re-scan the original vs fixed content with the same engine,
      // keeping the real relative path so type-specific rules (e.g. MCP) fire. If
      // the CLI/core build is stale or unavailable, skip verification rather than
      // fail — the deterministic edits + residual self-check still stand.
      try {
        const { scanFiles } = await import('@promptsonar/cli');
        const relativePath = safeRelativePath(filePath);
        const beforeDir = writeAndScanRoot(content, relativePath);
        const afterDir = writeAndScanRoot(fixed, relativePath);
        tmpDirs.push(beforeDir, afterDir);
        const beforeScan = await scanFiles(beforeDir, {});
        const afterScan = await scanFiles(afterDir, {});
        beforeCount = beforeScan.reduce((n, r) => n + r.findings.length, 0);
        afterCount = afterScan.reduce((n, r) => n + r.findings.length, 0);
      } catch {
        beforeCount = null;
        afterCount = null;
      }
    }

    const verified = applied.length > 0 && residualClear && (afterCount === null || (beforeCount !== null && afterCount <= beforeCount));

    return NextResponse.json({
      fixed,
      applied: applied.map((edit) => ({
        fixerId: edit.fixerId,
        line: edit.line,
        match: edit.match,
        replacement: edit.replacement,
        description: edit.description,
      })),
      appliedCount: applied.length,
      residualClear,
      verified,
      rescan: beforeCount === null ? null : { before: beforeCount, after: afterCount },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Fix computation failed' }, { status: 500 });
  } finally {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}
