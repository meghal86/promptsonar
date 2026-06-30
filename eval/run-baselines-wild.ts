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
import * as os from 'os';
const SS_BIN = process.env.SKILLSPECTOR_BIN || '/tmp/skillspector/SkillSpector-main/.venv/bin/skillspector';
const TIMEOUT = Number(process.env.SS_TIMEOUT_MS || 120000);
// SkillSpector is a skill/file-level scanner and does not scale to full
// monorepos (it walks every file). Whole-repo scans time out on large repos
// REGARDLESS of OSV settings (measured). SS_SCOPE=ai (default) therefore scans
// each repo's extracted AI-artifact surface — the same prompt/skill/agent/MCP
// files PromptSonar analyzes — which is both fair (same surface) and tractable.
// SS_SCOPE=full reverts to the original whole-repo behavior.
const SS_SCOPE = (process.env.SS_SCOPE || 'ai').toLowerCase();
const AI_MAX_FILES = 400;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo', 'vendor']);
const AI_BASENAMES = new Set(['skill.md', 'skills.md', 'agent.md', 'agents.md', 'claude.md', 'prompt.md', '.cursorrules', 'mcp.json', '.mcp.json', 'claude_desktop_config.json']);
const AI_EXTS = new Set(['.prompt', '.ai', '.chat', '.system']);
function isAiFile(rel: string): boolean {
  const lower = rel.toLowerCase();
  const base = lower.split('/').pop() || '';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
  if (AI_BASENAMES.has(base) || AI_EXTS.has(ext)) return true;
  return /(^|\/)\.cursor\/|(^|\/)\.claude\/|(^|\/)skills\//.test(lower);
}
function collectAiFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= AI_MAX_FILES) return;
    let entries: fs.Dirent[]; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= AI_MAX_FILES) return;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); }
      else { const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/'); if (isAiFile(rel)) out.push(rel); }
    }
  };
  walk(root);
  return out;
}
// Build a temp "AI surface" view of a repo (relative paths preserved) for SkillSpector.
function aiView(repoDir: string): { dir: string; fileCount: number; cleanup: () => void } | null {
  const files = collectAiFiles(repoDir);
  if (files.length === 0) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ssview-'));
  for (const rel of files) {
    const src = path.join(repoDir, rel), dst = path.join(tmp, rel);
    try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); } catch { /* skip */ }
  }
  return { dir: tmp, fileCount: files.length, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

function ssScan(repoDir: string): { issues: number; severity: string; ms: number; scope: string; aiFiles?: number } | { error: string } {
  let target = repoDir, cleanup = () => {}, aiFiles: number | undefined;
  if (SS_SCOPE === 'ai') {
    const v = aiView(repoDir);
    if (!v) return { issues: 0, severity: 'LOW', ms: 0, scope: 'ai', aiFiles: 0 };
    target = v.dir; cleanup = v.cleanup; aiFiles = v.fileCount;
  }
  try {
    const t0 = Date.now();
    const stdout = execFileSync(SS_BIN, ['scan', target, '--no-llm', '--format', 'json'],
      { maxBuffer: 128 * 1024 * 1024, timeout: TIMEOUT });
    const r = JSON.parse(stdout.toString());
    return { issues: (r.issues || []).length, severity: r?.risk_assessment?.severity || 'LOW', ms: Date.now() - t0, scope: SS_SCOPE, aiFiles };
  } catch (e: any) {
    const out = e.stdout ? e.stdout.toString() : '';
    try { const r = JSON.parse(out); return { issues: (r.issues || []).length, severity: r?.risk_assessment?.severity || 'LOW', ms: 0, scope: SS_SCOPE, aiFiles }; }
    catch { /* ignore */ }
    const timedOut = /ETIMEDOUT|timed? ?out|killed/i.test(String(e.message || e));
    return { error: timedOut ? 'timeout' : String(e.message || e).slice(0, 200) };
  } finally { cleanup(); }
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
    else { rec.skillspector = { issues: ss.issues, severity: ss.severity, scanSeconds: Math.round(ss.ms / 100) / 10, scope: ss.scope, aiFiles: ss.aiFiles }; }

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
    skillspectorScope: SS_SCOPE === 'ai'
      ? "ai-artifact surface (prompt/skill/agent/MCP files only) — SkillSpector does not scale to full monorepos; whole-repo scans time out regardless of OSV settings (measured). Scoping to the AI surface is the same surface PromptSonar analyzes."
      : 'full repository (whole tree)',
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
