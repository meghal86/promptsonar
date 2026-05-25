# PromptSonar 30-Repo Evidence Summary

Generated on 2026-05-25 with local PromptSonar CLI v1.2.0.

## Method

- Candidate source: manual fallback list of active AI repositories after GitHub API search hit a rate limit.
- Languages: Python, TypeScript, JavaScript.
- Scan command: `node packages/cli/dist/cli.js scan <repo> --json --output <result-file>`.
- Strict production-like counts exclude docs, tests, examples, fixtures, benchmarks, notebooks, samples, demos, and README/Markdown files.
- Raw JSON outputs are intentionally not committed because they are large generated artifacts.

## Results

| Metric | Count | Rate |
| --- | ---: | ---: |
| Repositories scanned | 30 | 100% |
| High/critical security signals in production-like files | 26 / 30 | 87% |
| High/critical secret or credential signals in production-like files | 24 / 30 | 80% |
| High/critical injection or jailbreak signals in production-like files | 23 / 30 | 77% |
| Clarity or ambiguity issues | 29 / 30 | 97% |

Average security-pillar score: 98/100.

## Interpretation

These are static-analysis signals, not confirmed vulnerabilities or CVEs. They are appropriate for public claims only when framed as “PromptSonar flagged risk signals” and not as “these projects are vulnerable.”

The score result is also useful: a high aggregate security score can coexist with repeated high-severity rule hits, so rule-level review matters more than a single headline score.

## Artifacts

- Candidate scanner: `research/repo-scan/find-candidates.js`
- Batch scanner: `research/repo-scan/scan-batch.js`
- Aggregator: `research/repo-scan/aggregate-results.js`
- Post drafts: `research/repo-scan/launch-posts.md`
- Local raw results: `results/repo-scan/` (ignored)
