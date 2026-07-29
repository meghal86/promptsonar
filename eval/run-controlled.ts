/**
 * run-controlled.ts — scan the controlled corpus and score PromptSonar against
 * ground truth. Deterministic; no LLM calls.
 *
 * Run:  node_modules/.bin/ts-node --transpile-only eval/run-controlled.ts
 * Out:  eval/results/controlled-results.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'packages/cli/dist/cli.js');
const MANIFEST = path.join(ROOT, 'eval/controlled-manifest.json');
const OUT = path.join(ROOT, 'eval/results/controlled-results.json');

const SCORED = /^(sec_|MCP-)/;
const NOISE = /^(MCP-007|bp_|struct_|clarity_|consistency_|efficiency_|ethics_)/;
const isScored = (id: string) => SCORED.test(id) && !NOISE.test(id);

type Case = {
  id: string; name: string; path: string; description?: string;
  expected_findings?: Array<{ rule_id: string; severity: string; confidence: string }>;
  expected_paths?: Array<{ chain: string; reachability: string; cross_file: boolean }>;
  true_negative?: boolean; known_gap?: boolean;
};

function scan(absPath: string): { report: any; ms: number } {
  const t0 = Date.now();
  const stdout = execFileSync('node', [CLI, 'repo', absPath, '--json'], { maxBuffer: 256 * 1024 * 1024 });
  const ms = Date.now() - t0;
  return { report: JSON.parse(stdout.toString()), ms };
}

function scoredFindings(report: any): Array<{ ruleId: string; severity: string }> {
  const out: Array<{ ruleId: string; severity: string }> = [];
  for (const block of report.findings || []) {
    for (const f of block.findings || []) {
      if (isScored(f.rule_id)) out.push({ ruleId: f.rule_id, severity: f.severity });
    }
  }
  // dedupe by ruleId+severity
  const seen = new Set<string>();
  return out.filter(f => { const k = f.ruleId + ':' + f.severity; if (seen.has(k)) return false; seen.add(k); return true; });
}

function sinkKeyword(chain: string): string | null {
  const c = chain.toLowerCase();
  if (c.includes('shell')) return 'Shell';
  if (c.includes('filesystem') || c.includes('file')) return 'Filesystem';
  if (c.includes('external api') || c.includes('external_api')) return 'External APIs';
  if (c.includes('network')) return 'Network';
  if (c.includes('secret') || c.includes('credential')) return 'Secrets';
  if (c.includes('memory')) return 'memory';
  return null;
}

function pathMatch(report: any, expected: { chain: string; cross_file: boolean }): boolean {
  const want = sinkKeyword(expected.chain);
  const paths = report.reachablePaths || [];
  return paths.some((p: any) => {
    const actions = (p.sensitiveActions || (p.sensitiveAction ? [p.sensitiveAction] : []));
    const isCross = new Set(p.files || []).size > 1;
    const sinkOk = !want || actions.some((a: string) => a === want) ||
      (want === 'memory' && (p.nodeIds || []).some((n: string) => /memory/i.test(n)));
    return sinkOk && isCross === expected.cross_file;
  });
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const cases: Case[] = manifest.cases;
  const perCase: any[] = [];
  let TP = 0, FP = 0, FN = 0, TN = 0, gapFN = 0;
  let tnCases = 0, tnPass = 0, gapCases = 0;
  let pathTP = 0, pathFN = 0;

  for (const c of cases) {
    const abs = path.join(ROOT, c.path);
    const rec: any = { id: c.id, name: c.name };
    if (!fs.existsSync(abs)) { rec.error = 'fixture missing'; perCase.push(rec); continue; }
    let report: any, ms = 0;
    try { const r = scan(abs); report = r.report; ms = r.ms; }
    catch (e: any) { rec.error = String(e.message || e).slice(0, 200); perCase.push(rec); continue; }

    const actual = scoredFindings(report);
    const actualIds = new Set(actual.map(f => f.ruleId));
    const expected = c.expected_findings || [];
    const expIds = expected.map(f => f.rule_id);
    const expSet = new Set(expIds);

    const tp = expIds.filter(id => actualIds.has(id));
    const fn = expIds.filter(id => !actualIds.has(id));
    const fp = [...actualIds].filter(id => !expSet.has(id));
    // severity discrepancies (soft)
    const sevDiff = expected.filter(e => actualIds.has(e.rule_id))
      .map(e => ({ ruleId: e.rule_id, expected: e.severity, actual: actual.find(a => a.ruleId === e.rule_id)!.severity }))
      .filter(d => d.expected !== d.actual);

    if (c.known_gap) { gapCases++; gapFN += fn.length; }
    else if (c.true_negative) { tnCases++; if (actual.length === 0) { tnPass++; TN++; } else { FP += actual.length; } }
    else { TP += tp.length; FN += fn.length; FP += fp.length; }

    // paths
    const expPaths = c.expected_paths || [];
    const pathResults = expPaths.map(ep => ({ ...ep, matched: pathMatch(report, ep) }));
    if (!c.known_gap) { pathTP += pathResults.filter(p => p.matched).length; pathFN += pathResults.filter(p => !p.matched).length; }

    rec.scanMs = ms;
    rec.expected = expIds;
    rec.actual = actual.map(f => `${f.ruleId}(${f.severity})`);
    rec.tp = tp; rec.fn = fn; rec.fp = fp;
    rec.severityDiscrepancies = sevDiff;
    rec.pathResults = pathResults;
    rec.true_negative = !!c.true_negative;
    rec.known_gap = !!c.known_gap;
    perCase.push(rec);
  }

  const precision = TP + FP === 0 ? 1 : TP / (TP + FP);
  const recall = TP + FN === 0 ? 1 : TP / (TP + FN);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const times = perCase.filter(p => p.scanMs).map(p => p.scanMs).sort((a, b) => a - b);
  const sec = (n: number) => Math.round(n / 100) / 10;

  const summary = {
    tool: 'PromptSonar',
    cases: cases.length,
    findings: { TP, FP, FN, TN },
    precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3),
    trueNegatives: { total: tnCases, passed: tnPass },
    knownGaps: { cases: gapCases, fnByDesign: gapFN },
    paths: { matched: pathTP, missed: pathFN },
    timing_s: times.length ? {
      mean: sec(times.reduce((a, b) => a + b, 0) / times.length),
      median: sec(times[Math.floor(times.length / 2)]),
      max: sec(times[times.length - 1]),
    } : null,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, cases: perCase }, null, 2));
  console.log('Controlled results ->', path.relative(ROOT, OUT));
  console.log(JSON.stringify(summary, null, 2));
}

main();
