#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'evidence');

function getJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'user-agent': 'promptsonar-adoption-metrics',
        ...(options.headers || {}),
      },
      method: options.method || 'GET',
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned ${res.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getVsCodeStats() {
  const body = JSON.stringify({
    filters: [{
      criteria: [{ filterType: 7, value: 'promptsonar-tools.promptsonar' }],
    }],
    flags: 914,
  });

  const data = await getJson('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });

  const extension = data.results?.[0]?.extensions?.[0];
  const stats = Object.fromEntries((extension?.statistics || []).map(stat => [stat.statisticName, stat.value]));
  return {
    publisher: extension?.publisher?.publisherName || 'promptsonar-tools',
    extension: extension?.extensionName || 'promptsonar',
    installs: stats.install || 0,
    average_rating: stats.averagerating || null,
    rating_count: stats.ratingcount || null,
  };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const [github, npmDownloads, vscode] = await Promise.all([
    getJson('https://api.github.com/repos/meghal86/promptsonar'),
    getJson('https://api.npmjs.org/downloads/point/last-week/@promptsonar/cli'),
    getVsCodeStats(),
  ]);

  const npmView = JSON.parse(execFileSync('npm', ['view', '@promptsonar/cli', 'version', 'dist-tags', '--json'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }));

  const npxVersion = execFileSync('npx', ['@promptsonar/cli', '--version'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }).trim();

  const snapshot = {
    captured_at: today,
    github: {
      repository: github.full_name,
      stars: github.stargazers_count,
      forks: github.forks_count,
      open_issues: github.open_issues_count,
    },
    npm: {
      package: npmDownloads.package,
      published_version: npmView.version,
      latest_dist_tag: npmView['dist-tags']?.latest,
      last_week_downloads: npmDownloads.downloads,
      download_window: {
        start: npmDownloads.start,
        end: npmDownloads.end,
      },
    },
    vscode_marketplace: vscode,
    npm_install_verification: {
      command: 'npx @promptsonar/cli --version',
      output: npxVersion,
    },
  };

  const outputPath = path.join(EVIDENCE_DIR, `${today}_metrics_snapshot.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
