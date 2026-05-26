# Benchmark And Research Methodology

PromptSonar benchmark claims must be reproducible, narrow, and framed as static-analysis signals. Do not treat a scanner finding as a confirmed exploit without human review.

## Current Evidence

The repository includes a 30-repository evidence workflow under `research/repo-scan/`.

The current evidence summary states:

- 30 repositories scanned.
- 26/30 repositories had high/critical prompt-security signals in production-like files.
- 24/30 repositories had high/critical secret or credential signals in production-like files.
- 23/30 repositories had high/critical injection or jailbreak signals in production-like files.
- 29/30 repositories had clarity or ambiguity issues.

Careful wording:

> In an initial 30-repository static-analysis sample, PromptSonar flagged high/critical prompt-security signals in 26/30 repositories after excluding docs, tests, examples, fixtures, benchmarks, notebooks, samples, demos, and README/Markdown files. These are scanner signals, not confirmed vulnerabilities or CVEs.

Avoid wording:

> 87% of open-source AI repositories are vulnerable.

## Dataset Criteria

For a public benchmark, document:

- Repository or fixture source.
- Language and framework.
- Star/activity threshold, if used.
- Last-updated date, if used.
- Whether docs/tests/examples were included or excluded.
- Whether findings were manually reviewed.
- Whether known vulnerable examples are synthetic or real-world.

Suggested repository criteria:

- JavaScript, TypeScript, or Python AI application/tooling repositories.
- Active maintenance within the stated time window.
- Prompt templates, agent instructions, MCP configs, or tool descriptions present in source.
- Exclude vendored dependencies and generated build artifacts.

## Scan Configuration

Record the exact command and version:

```bash
node packages/cli/dist/cli.js scan <repo> --json --output results/<repo>.json
```

or, for published package reproduction:

```bash
npx @promptsonar/cli scan <repo> --json --output results/<repo>.json
```

For MCP configs:

```bash
npx @promptsonar/cli audit-mcp <path> --format json --output mcp-results.json
```

For SARIF:

```bash
npx @promptsonar/cli scan <repo> --sarif --output promptsonar.sarif
```

## Reproducing The 30-Repo Workflow

The local workflow is intentionally lightweight:

```bash
node research/repo-scan/find-candidates.js
node research/repo-scan/scan-batch.js 30
node research/repo-scan/aggregate-results.js
```

Notes:

- `find-candidates.js` may hit GitHub API rate limits.
- `scan-batch.js` shallow-clones repositories into `/tmp/promptsonar-repo-scan`.
- Raw JSON outputs are generated under `results/repo-scan/` and ignored because they can become large.
- `aggregate-results.js` writes summary artifacts and excludes common non-production paths for the stricter count.

## Interpreting Results

Use this language:

- "PromptSonar flagged..."
- "Static-analysis signals..."
- "Requires human review..."
- "May include false positives..."

Do not use this language without manual confirmation:

- "Exploit confirmed."
- "Repository is vulnerable."
- "Credential is live."
- "CVE-level issue."

## Limitations

- Static analysis cannot prove runtime exploitability.
- Prompt strings in tests, docs, examples, and training data can intentionally contain attacks.
- Secret-like values may be fake, redacted, or test credentials.
- Lack of a finding does not prove a prompt is secure.
- Dynamic prompt assembly can hide risk from static source scans.
- Some rule categories are quality or maintainability signals, not direct security vulnerabilities.

## Benchmark Fixtures

The `benchmarks/` directory contains prompt and MCP config fixtures for repeatable regression tests. These fixtures are useful for rule validation, but they are not a substitute for scanning real production repositories.

When publishing benchmark results, cite both:

- Fixture results for rule behavior.
- Repository-scan results for real-world signal prevalence.
