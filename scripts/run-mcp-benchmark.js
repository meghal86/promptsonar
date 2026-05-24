const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(repoRoot, 'benchmarks', 'mcp', 'fixtures');
const expectedPath = path.join(repoRoot, 'benchmarks', 'mcp', 'expected-rules.json');
const resultsDir = path.join(repoRoot, 'benchmarks', 'mcp', 'results');
const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

if (!fs.existsSync(cliPath)) {
  console.error('Missing packages/cli/dist/cli.js. Run npm run build --workspace packages/cli first.');
  process.exit(1);
}

const expectedRules = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));
const fixtures = Object.keys(expectedRules).sort();
fs.mkdirSync(resultsDir, { recursive: true });

function uniqueRuleIds(results) {
  const ids = new Set();
  for (const result of results) {
    for (const finding of result.findings || []) {
      ids.add(finding.rule_id);
    }
  }
  return Array.from(ids).sort();
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const rows = [];

for (const fixture of fixtures) {
  const fixturePath = path.join(fixtureDir, fixture);
  const run = spawnSync(process.execPath, [cliPath, 'audit-mcp', fixturePath, '--json'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });

  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch (err) {
    rows.push({
      fixture,
      expected: expectedRules[fixture].sort(),
      actual: [],
      status: 'error',
      exitCode: run.status,
      error: `Could not parse CLI JSON output: ${err.message}`,
      stderr: run.stderr.trim(),
    });
    continue;
  }

  const expected = expectedRules[fixture].slice().sort();
  const actual = uniqueRuleIds(parsed);
  rows.push({
    fixture,
    expected,
    actual,
    status: arraysEqual(expected, actual) ? 'pass' : 'fail',
    exitCode: run.status,
    findingCount: parsed.reduce((sum, result) => sum + (result.findings || []).length, 0),
  });
}

const passCount = rows.filter(row => row.status === 'pass').length;
const summary = {
  generatedAt: new Date().toISOString(),
  fixtureCount: rows.length,
  passCount,
  failCount: rows.length - passCount,
  rows,
};

const datePrefix = new Date().toISOString().slice(0, 10);
const jsonPath = path.join(resultsDir, `${datePrefix}-mcp-benchmark.json`);
const mdPath = path.join(resultsDir, `${datePrefix}-mcp-benchmark.md`);

const markdown = [
  '# PromptSonar MCP Benchmark Summary',
  '',
  `Generated: ${summary.generatedAt}`,
  '',
  `Fixtures: ${summary.fixtureCount}`,
  `Passed: ${summary.passCount}`,
  `Failed: ${summary.failCount}`,
  '',
  '| Fixture | Expected Rules | Actual Rules | Exit Code | Status |',
  '|---|---|---|---:|---|',
  ...rows.map(row => `| \`${row.fixture}\` | ${row.expected.length ? row.expected.map(id => `\`${id}\``).join(', ') : 'none'} | ${row.actual.length ? row.actual.map(id => `\`${id}\``).join(', ') : 'none'} | ${row.exitCode} | ${row.status.toUpperCase()} |`),
  '',
  '## Interpretation',
  '',
  'This benchmark verifies advertised MCP rule classes against synthetic safe and vulnerable configs. It is intended as launch evidence and regression coverage, not a substitute for a large real-world corpus.',
  '',
].join('\n');

fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(mdPath, markdown);

console.log(`MCP benchmark: ${summary.passCount}/${summary.fixtureCount} passed`);
console.log(`JSON: ${path.relative(repoRoot, jsonPath)}`);
console.log(`Markdown: ${path.relative(repoRoot, mdPath)}`);

if (summary.failCount > 0) {
  process.exit(1);
}
