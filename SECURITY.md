# Security Policy

## Reporting a vulnerability in PromptSonar

Please **do not open a public issue** for a security vulnerability in
PromptSonar itself (the CLI, core engine, GitHub Action, editor extensions or
dashboard).

Report it privately through GitHub:
**[Report a vulnerability](https://github.com/meghal86/promptsonar/security/advisories/new)**
(Security tab → Advisories → Report a vulnerability).

Include the affected component and version, steps to reproduce, and the impact
you observed. You should receive an acknowledgement within 5 business days.
Please allow time for a fix to be released before disclosing publicly.

## Supported versions

Security fixes are released for the latest published version of
`@promptsonar/core` and `@promptsonar/cli` (and the matching GitHub Action,
VS Code and Cursor extensions). Please upgrade before reporting.

## What is not a vulnerability report

- **A false positive or missed finding** is a detection-quality issue. Open a
  normal issue with the "False positive / missed finding" template.
- **A vulnerability PromptSonar found in another project** belongs to that
  project. Report it to its maintainers through their own security policy, not
  here.

## Scope notes

PromptSonar is a static analyser: the scanning engine makes no network or LLM
calls and does not execute the code it scans. The GitHub Action additionally
calls the GitHub API with the workflow's token to list a pull request's changed
files and post review comments, and uploads SARIF to the repository's own
code-scanning results when `upload-sarif` is enabled (the default). The hosted
dashboard receives the files you choose to upload for a scan.
