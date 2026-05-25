const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(ROOT, 'results/repo-scan');
const TEMP_DIR = '/tmp/promptsonar-repo-scan';
const CANDIDATES_FILE = path.join(OUT_DIR, 'candidates.json');
const TARGETS_FILE = path.join(OUT_DIR, 'targets.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'scan-status.json');
const CLI = path.join(ROOT, 'packages/cli/dist/cli.js');
const LIMIT = Number(process.argv[2] || 30);

function safeName(fullName) {
  return fullName.replace(/[^\w.-]+/g, '__');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    ...options,
  });
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE, 'utf8'));
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(candidates, null, 2));

  const statuses = [];
  let scannedCount = 0;
  for (const repo of candidates) {
    if (scannedCount >= LIMIT) {
      break;
    }

    const name = safeName(repo.full_name);
    const cloneDir = path.join(TEMP_DIR, name);
    const outputFile = path.join(OUT_DIR, `${name}.json`);
    const logFile = path.join(OUT_DIR, `${name}.log`);

    fs.rmSync(cloneDir, { recursive: true, force: true });
    console.log(`\n[clone] ${repo.full_name}`);
    const clone = run('git', ['clone', '--depth', '1', `https://github.com/${repo.full_name}.git`, cloneDir], { timeout: 120000 });

    if (clone.status !== 0) {
      statuses.push({ ...repo, status: 'clone_failed', exit_code: clone.status, error: clone.stderr || clone.stdout });
      fs.writeFileSync(logFile, `${clone.stdout || ''}\n${clone.stderr || ''}`);
      continue;
    }

    console.log(`[scan] ${repo.full_name}`);
    const scan = run(process.execPath, [CLI, 'scan', cloneDir, '--json', '--output', outputFile], {
      timeout: 180000,
    });
    fs.writeFileSync(logFile, `${scan.stdout || ''}\n${scan.stderr || ''}`);

    statuses.push({
      ...repo,
      status: fs.existsSync(outputFile) ? 'scanned' : 'scan_failed',
      exit_code: scan.status,
      result_file: outputFile,
      log_file: logFile,
    });
    if (fs.existsSync(outputFile)) {
      scannedCount += 1;
    }

    fs.rmSync(cloneDir, { recursive: true, force: true });
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(statuses, null, 2));
  }

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(statuses, null, 2));
  console.log(`\nWrote scan status to ${SUMMARY_FILE}`);
}

main();
