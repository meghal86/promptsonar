/**
 * run-baselines.ts — run the SkillSpector baseline against the CONTROLLED corpus
 * and score it on the subset where comparison is valid.
 *
 * SkillSpector is a skill/file-level scanner ("scan ./my-skill/" or SKILL.md).
 * PromptSonar is repo-level (cross-file execution paths). For cases whose risk
 * is fundamentally cross-file / MCP-config / memory (a different granularity),
 * we record "out_of_scope" rather than scoring SkillSpector zero.
 *
 * Determinism constraint: only SkillSpector --no-llm is run. The +LLM column is
 * recorded as not-run (requires an API key and would incur cost + nondeterminism).
 *
 * Run: SKILLSPECTOR_BIN=/path/to/skillspector \
 *      TS_NODE_PROJECT=eval/tsconfig.json node_modules/.bin/ts-node --transpile-only eval/run-baselines.ts
 * Out: eval/results/baseline-results.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'eval/controlled-manifest.json');
const OUT = path.join(ROOT, 'eval/results/baseline-results.json');
const SS_BIN = process.env.SKILLSPECTOR_BIN || '/tmp/skillspector/SkillSpector-main/.venv/bin/skillspector';

function ssScan(dir: string): { result: any; ms: number } | { error: string } {
  try {
    const t0 = Date.now();
    const stdout = execFileSync(SS_BIN, ['scan', dir, '--no-llm', '--format', 'json'],
      { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
    return { result: JSON.parse(stdout.toString()), ms: Date.now() - t0 };
  } catch (e: any) {
    // SkillSpector exits non-zero when it finds issues; stdout still has JSON.
    const out = e.stdout ? e.stdout.toString() : '';
    try { return { result: JSON.parse(out), ms: 0 }; } catch { /* fall through */ }
    return { error: String(e.message || e).slice(0, 200) };
  }
}

// A controlled case is comparable to a skill/file-level scanner when its risk is
// a single instruction artifact. It is out_of_scope when the risk is cross-file,
// an MCP/.cursor config, or a memory store (granularities SkillSpector lacks).
function isOutOfScope(c: any, dir: string): boolean {
  if ((c.expected_paths || []).some((p: any) => p.cross_file)) return true;
  const files = walk(dir);
  if (files.some(f => /(^|\/)\.?mcp\.json$|(^|\/)\.cursor\//i.test(f) || /\.cursor\/mcp\.json$/i.test(f))) return true;
  if (files.some(f => /(^|\/)memory\//i.test(f) || /context\.yaml$|state\.yaml$/i.test(f))) return true;
  return false;
}
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

function ssFlags(result: any): boolean {
  const sev = String(result?.risk_assessment?.severity || '').toUpperCase();
  const issues = (result?.issues || []).length;
  return issues > 0 || ['MEDIUM', 'HIGH', 'CRITICAL'].includes(sev);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const cases = manifest.cases;
  const perCase: any[] = [];
  let TP = 0, FP = 0, FN = 0, TN = 0, comparable = 0, oos = 0;
  const times: number[] = [];

  for (const c of cases) {
    const dir = path.join(ROOT, c.path);
    const rec: any = { id: c.id, name: c.name };
    if (!fs.existsSync(dir)) { rec.error = 'fixture missing'; perCase.push(rec); continue; }

    const scoped = isOutOfScope(c, dir);
    const scan = ssScan(dir);
    if ('error' in scan) { rec.skillspector = { error: scan.error }; perCase.push(rec); continue; }
    if (scan.ms) times.push(scan.ms);

    const flags = ssFlags(scan.result);
    rec.skillspector = {
      severity: scan.result?.risk_assessment?.severity,
      score: scan.result?.risk_assessment?.score,
      issues: (scan.result?.issues || []).length,
      flags,
      scanMs: scan.ms,
    };

    const expectedPositive = (c.expected_findings || []).length > 0 || (c.expected_paths || []).length > 0;
    if (scoped) { rec.scope = 'out_of_scope'; oos++; }
    else {
      rec.scope = 'comparable'; comparable++;
      if (c.true_negative) { if (flags) FP++; else { TN++; } }
      else if (expectedPositive) { if (flags) TP++; else FN++; }
    }
    perCase.push(rec);
  }

  const precision = TP + FP === 0 ? (TP === 0 ? null : 1) : TP / (TP + FP);
  const recall = TP + FN === 0 ? (TP === 0 ? null : 1) : TP / (TP + FN);
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall) : null;
  const sec = (n: number) => Math.round(n / 100) / 10;

  const summary = {
    baseline: 'SkillSpector --no-llm (deterministic)',
    version: '2.3.7',
    cases: cases.length,
    comparableCases: comparable,
    outOfScopeCases: oos,
    onComparable: {
      TP, FP, FN, TN,
      precision: precision == null ? null : +precision.toFixed(3),
      recall: recall == null ? null : +recall.toFixed(3),
      f1: f1 == null ? null : +f1.toFixed(3),
    },
    timing_s: times.length ? {
      mean: sec(times.reduce((a, b) => a + b, 0) / times.length),
      median: sec(times.sort((a, b) => a - b)[Math.floor(times.length / 2)]),
      max: sec(Math.max(...times)),
    } : null,
    skillspectorWithLLM: {
      run: false,
      reason: 'Requires an API key and would violate the deterministic + no-cost constraint; recorded as not-run per CONSTRAINTS.',
      costUSD: 0,
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, cases: perCase }, null, 2));
  console.log('Baseline results ->', path.relative(ROOT, OUT));
  console.log(JSON.stringify(summary, null, 2));
}

main();
