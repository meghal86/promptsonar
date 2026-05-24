# PromptSonar 1.1.0 Publish Runbook

This runbook is for publishing the MCP audit release to npm and the VS Code Marketplace.

## Current Public Baseline

- npm `@promptsonar/core`: `1.1.0`
- npm `@promptsonar/cli`: `1.1.0`
- VS Code Marketplace `promptsonar-tools.promptsonar`: `1.0.27`

## Prepared Local Release

- Local package version: `1.1.0`
- CLI runtime version: `1.1.0`
- VSIX artifact: `packages/vscode-extension/promptsonar-1.1.0.vsix`
- npm publish: completed for `@promptsonar/core@1.1.0` and `@promptsonar/cli@1.1.0`
- VSCE package: passed

## Required Auth

Publishing is currently blocked on VS Code Marketplace credentials:

- `vsce verify-pat promptsonar-tools` returns an expired Personal Access Token error.

## Publish Commands

Verify npm:

```bash
npm view @promptsonar/core version
npm view @promptsonar/cli version
npx @promptsonar/cli@latest --version
npx @promptsonar/cli@latest audit-mcp tests/fixtures/mcp/vulnerable-mcp.json --json
```

Run after refreshing the VS Code Marketplace PAT:

```bash
cd packages/vscode-extension
npx vsce login promptsonar-tools
npm run publish:marketplace
```

When `vsce login` says `Publisher 'promptsonar-tools' is already known` and asks whether to overwrite the PAT, answer `y`. Answering `n` keeps the expired token and publish will fail.

Do not run plain `npx vsce publish` from the extension folder. In this monorepo it can try to auto-detect and package dependency folders, causing duplicate case-insensitive paths from `node_modules`. Use the prepared VSIX package path with `--no-dependencies`, which is what `npm run publish:marketplace` does.

Verify Marketplace:

```bash
npx vsce show promptsonar-tools.promptsonar --json
```

## Post-Publish Evidence

After publish, update:

- `ADOPTION.md` Release Milestones table.
- `/evidence/` screenshots for npm and VS Code Marketplace `1.1.0`.
- `docs/task.md` publish checklist.
