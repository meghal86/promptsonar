/**
 * run-baselines-wild.ts — run SkillSpector --no-llm against each wild repo and
 * compare coverage with PromptSonar (from wild-results.json).
 *
 * Key question: cross-file execution paths PromptSonar reconstructs are invisible
 * to a per-file/per-skill scanner. We quantify that gap per repo.
 *
 * Run: SKILLSPECTOR_BIN=... TS_NODE_PROJECT=eval/tsconfig.json \
 *      node_modules/.bin/ts-node --transpile-only eval/run-baselines-wild.ts
 * Out: eval/results/baseline-wild-results.json
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const REPOS = path.join(ROOT, 'eval/corpus/wild/repos.json');
const CLONES = path.join(ROOT, 'eval/corpus/wild/clones');
const PS_WILD = path.join(ROOT, 'eval/results/wild-results.json');
const OUT = path.join(ROOT, 'eval/results/baseline-wild-results.json');
const SS_BIN = process.env.SKILLSPECTOR_BIN || '/tmp/skillspector/SkillSpector-main/.venv/bin/skillspector';
const TIMEOUT = Number(process.env.SS_TIMEOUT_MS || 120000);

function ssScan(dir: string): { issues: number; severity: string; ms: number } | { error: string } {
  try {
    const t0 = Date.now();
    const stdout = execFileSync(SS_BIN, ['scan', dir, '--no-llm', '--format', 'json'],
      { maxBuffer: 128 * 1024 * 1024, timeout: TIMEOUT });
    const r = JSON.parse(stdout.toString());
    return { issues: (r.issues || []).length, severity: r?.risk_assessment?.severity || 'LOW', ms: Date.now() - t0 };
  } catch (e: any) {
    const out = e.stdout ? e.stdout.toString() : '';
    try { const r = JSON.parse(out); return { issues: (r.issues || []).length, severity: r?.risk_assessment?.severity || 'LOW', ms: 0 }; }
    catch { /* ignore */ }
    const timedOut = /ETIMEDOUT|timed? ?out|killed/i.test(String(e.message || e));
    return { error: timedOut ? 'timeout' : String(e.message || e).slice(0, 200) };
  }
}

function main() {
  const repos = JSON.parse(fs.readFileSync(REPOS, 'utf8')).repos as any[];
  const psWild = fs.existsSync(PS_WILD) ? JSON.parse(fs.readFileSync(PS_WILD, 'utf8')) : { repos: [] };
  const psById: Record<string, any> = {};
  for (const r of psWild.repos || []) psById[r.id] = r;

  const out: any[] = [];
  let ssErr = 0;
  let psFindsSSMisses = 0, ssFindsPSMisses = 0, bothFind = 0, neitherFind = 0;
  let totalPSCrossFile = 0, totalSSIssues = 0;

  for (const r of repos) {
    const dir = path.join(CLONES, r.id);
    const ps = psById[r.id];
    const rec: any = { id: r.id, repo: r.repo, category: r.category };
    if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) { rec.status = 'skipped'; out.push(rec); continue; }

    const ss = ssScan(dir);
    if ('error' in ss) { rec.skillspector = { error: ss.error }; ssErr++; }
    else { rec.skillspector = { issues: ss.issues, severity: ss.severity, scanSeconds: Math.round(ss.ms / 100) / 10 }; }

    const psFindings = ps?.status === 'ok' ? (ps.findingsTotal || 0) : null;
    const psCrossFile = ps?.status === 'ok' ? (ps.crossFilePaths || 0) : null;
    const ssIssues = ('issues' in ss) ? ss.issues : null;

    rec.promptsonar = { findings: psFindings, crossFilePaths: psCrossFile, executionPaths: ps?.executionPaths ?? null };
    rec.skillspectorIssues = ssIssues;

    if (psFindings != null && ssIssues != null) {
      const psPos = psFindings > 0, ssPos = ssIssues > 0;
      if (psPos && !ssPos) psFindsSSMisses++;
      else if (!psPos && ssPos) ssFindsPSMisses++;
      else if (psPos && ssPos) bothFind++;
      else neitherFind++;
      if (psCrossFile != null) totalPSCrossFile += psCrossFile;
      totalSSIssues += ssIssues;
    }
    out.push(rec);
  }

  // The decisive cross-file metric: SkillSpector has no cross-file path concept,
  // so every PromptSonar cross-file path is, by construction, undetectable by it.
  const reposWithPSCrossFile = out.filter(r => (r.promptsonar?.crossFilePaths || 0) > 0).length;

  const summary = {
    baseline: 'SkillSpector --no-llm vs PromptSonar (wild corpus)',
    reposCompared: out.filter(r => r.promptsonar?.findings != null && r.skillspectorIssues != null).length,
    skillspectorErrors: ssErr,
    coverageDiff: {
      promptsonarFindsSkillspectorMisses: psFindsSSMisses,
      skillspectorFindsPromptsonarMisses: ssFindsPSMisses,
      bothFind, neitherFind,
    },
    crossFileGap: {
      reposWithPromptsonarCrossFilePath: reposWithPSCrossFile,
      totalPromptsonarCrossFilePaths: totalPSCrossFile,
      skillspectorCrossFilePathsDetected: 0,
      note: 'SkillSpector scans per-file/per-skill and has no cross-file execution-path model; all PromptSonar cross-file paths are out of its detection scope.',
    },
    totalSkillspectorIssues: totalSSIssues,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), summary, repos: out }, null, 2));
  console.log('Baseline wild results ->', path.relative(ROOT, OUT));
  console.log(JSON.stringify(summary, null, 2));
}

main();
