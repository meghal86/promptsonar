const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT_DIR = path.resolve(__dirname, '../../results/repo-scan');
const OUT_FILE = path.join(OUT_DIR, 'candidates.json');
const MIN_UPDATED_AT = new Date('2025-11-25T00:00:00Z');

const queries = [
  '"system prompt" language:javascript',
  '"prompt template" language:python',
  '"llm prompt" language:typescript',
  '"assistant prompt" language:javascript',
  '"chatgpt prompt" filename:prompt',
  '"system prompt" language:typescript',
  '"prompt template" language:javascript',
  '"assistant prompt" language:python',
];

function getGitHubToken() {
  try {
    const output = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const line = output.split('\n').find((entry) => entry.startsWith('password='));
    return line ? line.slice('password='.length) : '';
  } catch {
    return process.env.GITHUB_TOKEN || '';
  }
}

async function github(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const token = getGitHubToken();
  const repos = new Map();

  for (const query of queries) {
    const encoded = encodeURIComponent(query);
    const data = await github(`/search/code?q=${encoded}&per_page=50`, token);

    for (const item of data.items || []) {
      const fullName = item.repository?.full_name;
      if (!fullName || repos.has(fullName)) continue;

      try {
        const repo = await github(`/repos/${fullName}`, token);
        const pushedAt = new Date(repo.pushed_at || repo.updated_at || 0);
        const language = repo.language || item.repository?.language || '';
        if ((repo.stargazers_count || 0) < 50) continue;
        if (pushedAt < MIN_UPDATED_AT) continue;
        if (!['JavaScript', 'TypeScript', 'Python'].includes(language)) continue;

        repos.set(fullName, {
          full_name: fullName,
          stars: repo.stargazers_count || 0,
          language,
          pushed_at: repo.pushed_at,
          html_url: repo.html_url,
          description: repo.description || '',
          matched_query: query,
          matched_path: item.path,
        });
      } catch (error) {
        console.error(`repo metadata failed for ${fullName}: ${error.message}`);
      }
    }
  }

  const candidates = Array.from(repos.values())
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 100);

  fs.writeFileSync(OUT_FILE, JSON.stringify(candidates, null, 2));
  console.log(`Wrote ${candidates.length} candidates to ${OUT_FILE}`);
  console.table(candidates.slice(0, 30).map((repo) => ({
    repo: repo.full_name,
    stars: repo.stars,
    language: repo.language,
    matched_path: repo.matched_path,
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
