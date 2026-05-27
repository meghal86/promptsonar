#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const outputDir = path.join(repoRoot, 'research', 'public-benchmark');

const repos = [
  'modelcontextprotocol/typescript-sdk',
  'modelcontextprotocol/python-sdk',
  'modelcontextprotocol/inspector',
  'modelcontextprotocol/servers',
  'upstash/context7',
  'browser-use/browser-use',
  'gpt-engineer-org/gpt-engineer',
  'FlowiseAI/Flowise',
  'mendableai/firecrawl',
  'langfuse/langfuse',
  'mem0ai/mem0',
  'deepset-ai/haystack',
  'guardrails-ai/guardrails',
  'microsoft/PromptWizard',
  'instructor-ai/instructor',
  'yoheinakajima/babyagi',
  'microsoft/JARVIS',
  'TransformerOptimus/SuperAGI',
  'microsoft/semantic-kernel',
  'microsoft/autogen',
];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf-8',
    timeout: options.timeout || 120000,
    maxBuffer: 50 * 1024 * 1024,
  });
}

function parseJsonOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return Array.from(new Set(values)).sort();
}

function findMcpCandidates(repoDir) {
  const candidates = [
    path.join(repoDir, 'mcp.json'),
    path.join(repoDir, '.cursor', 'mcp.json'),
    path.join(repoDir, 'claude_desktop_config.json'),
  ];

  const rg = run('find', [repoDir, '-maxdepth', '4', '-type', 'f', '(', '-name', '*mcp*.json', '-o', '-name', 'claude_desktop_config.json', ')'], {
    timeout: 30000,
  });
  if (rg.status === 0 && rg.stdout.trim()) {
    candidates.push(...rg.stdout.trim().split(/\r?\n/));
  }

  return unique(candidates).filter(filePath => fs.existsSync(filePath));
}

function findPromptCandidates(repoDir) {
  const find = run('find', [
    repoDir,
    '-maxdepth',
    '5',
    '-type',
    'f',
    '(',
    '-iname',
    '*prompt*',
    '-o',
    '-iname',
    '*agent*',
    '-o',
    '-iname',
    '*skill*',
    '-o',
    '-iname',
    '*system*',
    ')',
  ], { timeout: 30000 });

  if (find.status !== 0 || !find.stdout.trim()) return [];

  const supported = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.yaml', '.yml', '.prompt', '.ai', '.chat', '.md']);
  return unique(find.stdout.trim().split(/\r?\n/)
    .filter(filePath => supported.has(path.extname(filePath).toLowerCase()))
    .filter(filePath => !/\/(node_modules|dist|build|coverage|\.next|docs|test|tests|__tests__)\//.test(filePath.replaceAll(path.sep, '/')))
  ).slice(0, 200);
}

function summarizePromptScan(parsed) {
  const results = asArray(parsed);
  const findings = results.flatMap(result => result.findings || []);
  const active = findings.filter(finding => !finding.waived);
  const bySeverity = {};
  const byRule = {};

  for (const finding of active) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byRule[finding.rule_id] = (byRule[finding.rule_id] || 0) + 1;
  }

  return {
    filesWithPromptFindings: results.filter(result => (result.findings || []).some(finding => !finding.waived)).length,
    promptFindingCount: active.length,
    promptCriticalHigh: active.filter(finding => ['critical', 'high'].includes(finding.severity)).length,
    promptRules: unique(active.map(finding => finding.rule_id)),
    promptBySeverity: bySeverity,
    promptTopRules: Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

function scanPromptCandidates(repoDir) {
  const candidates = findPromptCandidates(repoDir);
  const parsedResults = [];
  let parseFailures = 0;

  for (const candidate of candidates) {
    const scan = run(process.execPath, [cliPath, 'scan', candidate, '--json', '--fail-on', 'none'], {
      cwd: repoRoot,
      timeout: 15000,
    });
    const parsed = parseJsonOutput(scan.stdout);
    if (parsed) {
      parsedResults.push(...asArray(parsed));
    } else {
      parseFailures += 1;
    }
  }

  return {
    promptCandidates: candidates.length,
    promptScanParseFailures: parseFailures,
    ...summarizePromptScan(parsedResults),
  };
}

function summarizeMcpAudits(repoDir) {
  const candidates = findMcpCandidates(repoDir);
  const allFindings = [];
  let parsedConfigs = 0;

  for (const candidate of candidates) {
    const audit = run(process.execPath, [cliPath, 'audit-mcp', candidate, '--json'], {
      cwd: repoRoot,
      timeout: 30000,
    });
    const parsed = parseJsonOutput(audit.stdout);
    if (!parsed) continue;
    parsedConfigs += asArray(parsed).length;
    for (const result of asArray(parsed)) {
      allFindings.push(...(result.findings || []));
    }
  }

  const byRule = {};
  for (const finding of allFindings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] || 0) + 1;
  }

  return {
    mcpConfigCandidates: candidates.length,
    mcpConfigsParsed: parsedConfigs,
    mcpFindingCount: allFindings.length,
    mcpCriticalHigh: allFindings.filter(finding => ['critical', 'high'].includes(finding.severity)).length,
    mcpRules: unique(allFindings.map(finding => finding.rule_id)),
    mcpTopRules: Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

function markdown(summary) {
  const rows = summary.rows.map(row => `| \`${row.repo}\` | ${row.status} | ${row.promptFindingCount} | ${row.promptCriticalHigh} | ${row.mcpConfigsParsed} | ${row.mcpFindingCount} | ${(row.promptRules || []).concat(row.mcpRules || []).slice(0, 8).map(rule => `\`${rule}\``).join(', ') || 'none'} |`);
  return [
    '# PromptSonar Public Repository Benchmark Report',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Scope',
    '',
    `PromptSonar scanned ${summary.repoCount} public AI/agent repositories from GitHub using the local CLI. Repositories were cloned shallowly into a temporary directory, scanned locally, summarized, and then deleted. No third-party source code is committed in this repository.`,
    '',
    'The benchmark includes prompt scanning and MCP config auditing where candidate MCP config files were found.',
    '',
    'Repository names are included for reproducibility. A finding in this report is not an assertion that a project is exploitable or that maintainers shipped a confirmed vulnerability.',
    '',
    '## Methodology',
    '',
    '- Scanner: local `packages/cli/dist/cli.js` from this repository.',
    '- Prompt scan command: `promptsonar scan <candidate-file> --json --fail-on none`.',
    '- Prompt candidates: files up to depth 5 whose names include prompt, agent, skill, or system, limited to the first 200 candidates per repo.',
    '- MCP audit command: `promptsonar audit-mcp <candidate> --json`.',
    '- Candidate MCP files: `mcp.json`, `.cursor/mcp.json`, `claude_desktop_config.json`, and `*mcp*.json` up to depth 4.',
    '- Findings are static-analysis signals, not confirmed exploits, CVEs, or maintainer-verified vulnerabilities.',
    '- Default PromptSonar ignores for docs/tests/build artifacts were active.',
    '',
    '## Results Summary',
    '',
    `- Repositories attempted: ${summary.repoCount}`,
    `- Repositories cloned successfully: ${summary.successCount}`,
    `- Prompt candidate files scanned: ${summary.promptCandidates}`,
    `- Repositories with prompt findings: ${summary.reposWithPromptFindings}`,
    `- Repositories with high/critical prompt signals: ${summary.reposWithPromptCriticalHigh}`,
    `- MCP config candidates parsed: ${summary.mcpConfigsParsed}`,
    `- Repositories with MCP findings: ${summary.reposWithMcpFindings}`,
    `- Repositories with high/critical MCP signals: ${summary.reposWithMcpCriticalHigh}`,
    '',
    '## Repository-Level Summary',
    '',
    '| Repository | Status | Prompt Findings | Prompt High/Critical | MCP Configs | MCP Findings | Rule Examples |',
    '|---|---|---:|---:|---:|---:|---|',
    ...rows,
    '',
    '## Top Static Signals',
    '',
    'Prompt rules:',
    '',
    ...summary.promptTopRules.map(([rule, count]) => `- \`${rule}\`: ${count}`),
    '',
    'MCP rules:',
    '',
    ...summary.mcpTopRules.map(([rule, count]) => `- \`${rule}\`: ${count}`),
    '',
    '## False-Positive Notes And Limitations',
    '',
    '- This benchmark does not manually confirm exploitability.',
    '- Some findings may come from examples, templates, or intentionally vulnerable fixtures that were not excluded by default ignores.',
    '- Secret-like strings may be fake, redacted, or non-production tokens; each requires review before disclosure.',
    '- Missing MCP auth indicators may be configured outside the checked JSON file.',
    '- Unknown remote domains are review signals, not proof of malicious infrastructure.',
    '- Results can change as repositories change.',
    '',
    '## Reproduce',
    '',
    '```bash',
    'npm run build --workspace packages/core',
    'npm run build --workspace packages/cli',
    'node scripts/run-public-benchmark.js',
    '```',
    '',
  ].join('\n');
}

if (!fs.existsSync(cliPath)) {
  console.error('Missing CLI build. Run npm run build --workspace packages/cli first.');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-public-benchmark-'));
const rows = [];

for (const repo of repos) {
  console.log(`[benchmark] ${repo}`);
  const repoDir = path.join(tmpRoot, repo.replace(/[/:]/g, '__'));
  const clone = run('git', ['clone', '--depth', '1', '--single-branch', `https://github.com/${repo}.git`, repoDir], {
    timeout: 90000,
  });

  if (clone.status !== 0) {
    rows.push({
      repo,
      status: 'clone_failed',
      error: clone.stderr.trim().split(/\r?\n/).slice(-2).join(' '),
      promptFindingCount: 0,
      promptCriticalHigh: 0,
      promptRules: [],
      mcpConfigsParsed: 0,
      mcpFindingCount: 0,
      mcpRules: [],
    });
    continue;
  }

  const promptSummary = scanPromptCandidates(repoDir);
  const mcpSummary = summarizeMcpAudits(repoDir);

  rows.push({
    repo,
    status: 'scanned',
    ...promptSummary,
    ...mcpSummary,
  });
}

fs.rmSync(tmpRoot, { recursive: true, force: true });

const promptRuleCounts = {};
const mcpRuleCounts = {};
for (const row of rows) {
  for (const [rule, count] of row.promptTopRules || []) {
    promptRuleCounts[rule] = (promptRuleCounts[rule] || 0) + count;
  }
  for (const [rule, count] of row.mcpTopRules || []) {
    mcpRuleCounts[rule] = (mcpRuleCounts[rule] || 0) + count;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  repoCount: repos.length,
  successCount: rows.filter(row => row.status === 'scanned').length,
  promptCandidates: rows.reduce((sum, row) => sum + (row.promptCandidates || 0), 0),
  reposWithPromptFindings: rows.filter(row => row.promptFindingCount > 0).length,
  reposWithPromptCriticalHigh: rows.filter(row => row.promptCriticalHigh > 0).length,
  mcpConfigsParsed: rows.reduce((sum, row) => sum + (row.mcpConfigsParsed || 0), 0),
  reposWithMcpFindings: rows.filter(row => row.mcpFindingCount > 0).length,
  reposWithMcpCriticalHigh: rows.filter(row => row.mcpCriticalHigh > 0).length,
  promptTopRules: Object.entries(promptRuleCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
  mcpTopRules: Object.entries(mcpRuleCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
  rows,
};

const datePrefix = new Date().toISOString().slice(0, 10);
const jsonPath = path.join(outputDir, `${datePrefix}-public-benchmark.json`);
const mdPath = path.join(outputDir, `${datePrefix}-public-benchmark.md`);
const docsPath = path.join(repoRoot, 'docs', 'benchmark-report.md');

fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
const report = markdown(summary);
fs.writeFileSync(mdPath, report);
fs.writeFileSync(docsPath, report);

console.log(`Public benchmark complete: ${summary.successCount}/${summary.repoCount} repos scanned`);
console.log(`Prompt high/critical repos: ${summary.reposWithPromptCriticalHigh}`);
console.log(`MCP high/critical repos: ${summary.reposWithMcpCriticalHigh}`);
console.log(`Report: ${path.relative(repoRoot, docsPath)}`);
