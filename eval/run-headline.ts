/**
 * run-headline.ts — derive paper headline statistics from wild-results.json.
 *
 * Run:  TS_NODE_PROJECT=eval/tsconfig.json node_modules/.bin/ts-node --transpile-only eval/run-headline.ts
 * Out:  eval/results/headline-stats.json
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'eval/results/wild-results.json');
const OUT = path.join(ROOT, 'eval/results/headline-stats.json');

// risk category -> sensitive action key in actionStats
const CATEGORIES: Array<{ key: string; action: string }> = [
  { key: 'shell_execution', action: 'Shell' },
  { key: 'filesystem_write', action: 'Filesystem' },
  { key: 'credential_access', action: 'Secrets' },
  { key: 'network_external', action: 'Network' },
];

function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 1000) / 10; }

function main() {
  const data = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const repos = (data.repos || []).filter((r: any) => r.status === 'ok');
  const N = repos.length;

  const reaches = (r: any, action: string, conf?: string) => {
    const s = r.actionStats?.[action];
    if (!s) return false;
    if (!conf) return s.total > 0;
    return (s[conf] || 0) > 0;
  };

  const categories = CATEGORIES.map(({ key, action }) => {
    const any = repos.filter((r: any) => reaches(r, action)).length;
    const confirmed = repos.filter((r: any) => reaches(r, action, 'confirmed')).length;
    const probable = repos.filter((r: any) => reaches(r, action, 'probable')).length;
    const potential = repos.filter((r: any) => reaches(r, action, 'potential')).length;
    return {
      risk: key, action,
      reposWithPath: any, pctRepos: pct(any, N),
      byConfidence: {
        confirmed: { repos: confirmed, pct: pct(confirmed, N) },
        probable: { repos: probable, pct: pct(probable, N) },
        potential: { repos: potential, pct: pct(potential, N) },
      },
    };
  });

  const crossFileRepos = repos.filter((r: any) => (r.crossFilePaths || 0) > 0).length;

  const stats = {
    generatedAt: new Date().toISOString(),
    reposScanned: N,
    crossFileOnly: {
      reposWithCrossFilePath: crossFileRepos, pctRepos: pct(crossFileRepos, N),
      note: 'Cross-file paths span >=2 files and are not detectable by per-file scanning.',
    },
    categories,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(stats, null, 2));
  console.log('Headline stats ->', path.relative(ROOT, OUT));
  console.log(JSON.stringify(stats, null, 2));
}

main();
