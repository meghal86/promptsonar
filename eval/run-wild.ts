/**
 * run-wild.ts — scan each fetched wild-corpus repo and record descriptive
 * statistics (no ground truth, so no precision/recall). Deterministic.
 *
 * Run:  TS_NODE_PROJECT=eval/tsconfig.json node_modules/.bin/ts-node --transpile-only eval/run-wild.ts
 * Out:  eval/results/wild-results.json
 *
 * Robust: a failed or slow scan is logged and skipped; the run never aborts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'packages/cli/dist/cli.js');
const REPOS = path.join(ROOT, 'eval/corpus/wild/repos.json');
const CLONES = path.join(ROOT, 'eval/corpus/wild/clones');
const OUT = path.join(ROOT, 'eval/results/wild-results.json');
const PER_REPO_TIMEOUT_MS = Number(process.env.WILD_TIMEOUT_MS || 180000);

const ACTIONS = ['Shell', 'Filesystem', 'Network', 'Secrets', 'External APIs'];

function emptyActionStats() {
  const m: Record<string, any> = {};
  for (const a of ACTIONS) m[a] = { total: 0, confirmed: 0, probable: 0, potential: 0, crossFile: 0 };
  return m;
}

function scanRepo(dir: string): { report: any; ms: number } {
  const t0 = Date.now();
  const stdout = execFileSync('node', [CLI, 'repo', dir, '--json'],
    { maxBuffer: 512 * 1024 * 1024, timeout: PER_REPO_TIMEOUT_MS });
  return { report: JSON.parse(stdout.toString()), ms: Date.now() - t0 };
}

function summarizeRepo(report: any) {
  const issues = report.issues || [];
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byConfidence = { confirmed: 0, probable: 0, potential: 0 };
  for (const i of issues) {
    if (i.severity in bySeverity) (bySeverity as any)[i.severity]++;
    // issue.confidence is an object { score, level, label, definition }.
    const c = String(i.confidence?.level || i.confidence?.label || i.confidence || '').toLowerCase();
    if (c in byConfidence) (byConfidence as any)[c]++;
  }
  const paths = report.reachablePaths || [];
  let crossFile = 0;
  const actionStats = emptyActionStats();
  const sinkTypes = new Set<string>();
  for (const p of paths) {
    const isCross = new Set(p.files || []).size > 1;
    if (isCross) crossFile++;
    const conf = String(p.confidenceLabel || '').toLowerCase();
    const actions: string[] = p.sensitiveActions && p.sensitiveActions.length ? p.sensitiveActions
      : (p.sensitiveAction ? [p.sensitiveAction] : []);
    for (const a of actions) {
      sinkTypes.add(a);
      if (actionStats[a]) {
        actionStats[a].total++;
        if (conf in actionStats[a]) actionStats[a][conf]++;
        if (isCross) actionStats[a].crossFile++;
      }
    }
  }
  const artifactsByType: Record<string, number> = {};
  for (const a of report.artifacts || []) artifactsByType[a.type] = (artifactsByType[a.type] || 0) + 1;

  return {
    findingsBySeverity: bySeverity,
    findingsTotal: issues.length,
    findingsByConfidence: byConfidence,
    executionPaths: paths.length,
    crossFilePaths: crossFile,
    uniqueSensitiveActionTypes: sinkTypes.size,
    sensitiveActionTypes: [...sinkTypes],
    actionStats,
    artifactsByType,
    artifactsTotal: (report.artifacts || []).length,
  };
}

function main() {
  const repos = JSON.parse(fs.readFileSync(REPOS, 'utf8')).repos as any[];
  const out: any[] = [];
  let scanned = 0, skipped = 0, failed = 0;

  for (const r of repos) {
    const dir = path.join(CLONES, r.id);
    const rec: any = { id: r.id, repo: r.repo, category: r.category };
    if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
      rec.status = 'skipped'; rec.reason = 'not fetched'; out.push(rec); skipped++;
      console.log(`skip   ${r.id} ${r.repo} (not fetched)`); continue;
    }
    try {
      const { report, ms } = scanRepo(dir);
      rec.status = 'ok'; rec.scanSeconds = Math.round(ms / 100) / 10;
      Object.assign(rec, summarizeRepo(report));
      out.push(rec); scanned++;
      console.log(`ok     ${r.id} ${r.repo} — ${rec.findingsTotal} findings, ${rec.executionPaths} paths (${rec.crossFilePaths} cross-file), ${rec.scanSeconds}s`);
    } catch (e: any) {
      const timedOut = /ETIMEDOUT|timed? ?out|killed/i.test(String(e.message || e)) || e.code === 'ETIMEDOUT';
      rec.status = 'error'; rec.reason = timedOut ? 'timeout' : String(e.message || e).slice(0, 200);
      out.push(rec); failed++;
      console.log(`FAIL   ${r.id} ${r.repo} — ${rec.reason}`);
    }
  }

  const okRepos = out.filter(r => r.status === 'ok');
  const times = okRepos.map(r => r.scanSeconds).sort((a, b) => a - b);
  const sum = (k: string) => okRepos.reduce((a, r) => a + (r[k] || 0), 0);
  const aggregate = {
    reposListed: repos.length, reposScanned: scanned, reposSkipped: skipped, reposFailed: failed,
    totalFindings: sum('findingsTotal'),
    findingsBySeverity: ['critical', 'high', 'medium', 'low'].reduce((acc: any, s) => {
      acc[s] = okRepos.reduce((a, r) => a + (r.findingsBySeverity?.[s] || 0), 0); return acc;
    }, {}),
    findingsByConfidence: ['confirmed', 'probable', 'potential'].reduce((acc: any, s) => {
      acc[s] = okRepos.reduce((a, r) => a + (r.findingsByConfidence?.[s] || 0), 0); return acc;
    }, {}),
    totalExecutionPaths: sum('executionPaths'),
    totalCrossFilePaths: sum('crossFilePaths'),
    scanSeconds: times.length ? {
      mean: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
      median: times[Math.floor(times.length / 2)],
      max: times[times.length - 1],
    } : null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), aggregate, repos: out }, null, 2));
  console.log('\nWild results ->', path.relative(ROOT, OUT));
  console.log(JSON.stringify(aggregate, null, 2));
}

main();
