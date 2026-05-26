# Dependency Audit Notes

Last reviewed: 2026-05-26

PromptSonar treats dependency audit output as launch-blocking for high and critical issues.

## Current Status

- Critical vulnerabilities: 0
- High vulnerabilities: 0
- Remaining npm audit findings: 2 moderate findings

## Remediated In This Pass

- Upgraded the dashboard from Next.js 14.2.3 to 15.5.18 to remove known high and critical Next.js advisories.
- Removed unused `@actions/artifact`, which pulled vulnerable archive and Octokit transitive dependencies.
- Replaced `@actions/github` with a direct GitHub REST call in the GitHub Action to avoid vulnerable HTTP-client transitive dependencies.
- Upgraded `@actions/core` to 3.0.1.
- Refreshed the lockfile with patched transitive versions for YAML, Vite, lodash, fast-xml-parser, minimatch, and related dependencies.

## Remaining Moderate Finding

`npm audit` currently reports a moderate PostCSS advisory under Next.js:

- Package path: `next -> postcss`
- Installed nested version: `postcss@8.4.31`
- Advisory: PostCSS CSS stringification escaping issue
- npm suggested fix: downgrade `next` to `9.3.3`

That suggested fix is not safe for PromptSonar because the dashboard is a modern Next.js App Router application. Downgrading to Next 9 would remove the framework features the dashboard depends on and would create a larger maintenance and security risk.

PromptSonar pins the dashboard to `next@15.5.18`, keeps a direct patched `postcss@8.5.15` dependency, and tracks this residual transitive advisory until Next publishes a release that updates its nested PostCSS dependency.

## Review Policy

- Do not ship with critical or high npm audit findings.
- Document any remaining moderate findings with package path, risk, and why the available fix is not safe.
- Re-run `npm audit` before each public release.
