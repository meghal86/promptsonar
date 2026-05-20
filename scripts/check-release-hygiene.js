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

console.log('Release hygiene check passed.');
