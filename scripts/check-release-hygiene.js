#!/usr/bin/env node

const { execFileSync } = require('child_process');

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
  .split('\n')
  .filter(Boolean);

const allowedGenerated = new Set([
  // GitHub JavaScript actions require the built entrypoint to be committed.
  'action/dist/action.js',
]);

const blockedPatterns = [
  /(^|\/)node_modules\//,
  /(^|\/)coverage\//,
  /(^|\/)\.next\//,
  /\.vsix$/,
  /\.tsbuildinfo$/,
  /^packages\/cli\/dist\//,
  /^packages\/core\/dist\//,
  /^packages\/vscode-extension\/dist\//,
  /^Agentsabha-angigravity\//,
  /^custom-writer-skill\//,
  /^my-writer-agent\//,
  /^scratch\//,
  /^output\/playwright\//,
  /\.tgz$/,
];

const offenders = tracked.filter(file => {
  if (allowedGenerated.has(file)) return false;
  return blockedPatterns.some(pattern => pattern.test(file));
});

if (offenders.length > 0) {
  console.error('Release hygiene check failed. These generated/local files are still tracked:\n');
  for (const offender of offenders) {
    console.error(`- ${offender}`);
  }
  console.error('\nUse git rm --cached for generated artifacts, or update scripts/check-release-hygiene.js if a file is intentionally tracked.');
  process.exit(1);
}

// Every package is released at one version. A drifted version string is how
// 1.5.0 shipped a CLI that reported 1.4.3, so check them all against the root.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8'));
const expected = readJson('package.json').version;
const versionProblems = [];
const manifests = ['action/package.json', ...fs.readdirSync(path.join(root, 'packages'))
  .map(dir => `packages/${dir}/package.json`)
  .filter(file => fs.existsSync(path.join(root, file)))];
for (const file of manifests) {
  const manifest = readJson(file);
  if (manifest.version !== expected) versionProblems.push(`${file}: version ${manifest.version}`);
  const coreRange = (manifest.dependencies || {})['@promptsonar/core'];
  if (coreRange && /^\^?\d/.test(coreRange) && coreRange.replace(/^\^/, '') !== expected) {
    versionProblems.push(`${file}: depends on @promptsonar/core ${coreRange}`);
  }
}
for (const [file, pattern] of [
  ['packages/core/src/version.ts', /PROMPTSONAR_VERSION = '([^']+)'/],
  ['packages/dashboard/src/lib/version.ts', /PROMPTSONAR_VERSION = "([^"]+)"/],
]) {
  const match = fs.readFileSync(path.join(root, file), 'utf-8').match(pattern);
  if (!match || match[1] !== expected) versionProblems.push(`${file}: ${match ? match[1] : 'no version constant'}`);
}
if (versionProblems.length > 0) {
  console.error(`Release hygiene check failed. Expected every package at ${expected}:\n`);
  for (const problem of versionProblems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log('Release hygiene check passed.');
