# PromptSonar 1.1.0 Publish Runbook

This runbook is for publishing the MCP audit release to npm and the VS Code Marketplace.

## Current Public Baseline

- npm `@promptsonar/core`: `1.0.28`
- npm `@promptsonar/cli`: `1.0.28`
- VS Code Marketplace `promptsonar-tools.promptsonar`: `1.0.27`

## Prepared Local Release

- Local package version: `1.1.0`
- CLI runtime version: `1.1.0`
- VSIX artifact: `packages/vscode-extension/promptsonar-1.1.0.vsix`
- npm publish dry-runs: passed for `@promptsonar/core` and `@promptsonar/cli`
- VSCE package: passed

## Required Auth

Publishing is currently blocked on local credentials:

- `npm whoami` returns `E401 Unauthorized`.
- `vsce verify-pat promptsonar-tools` returns an expired Personal Access Token error.

## Publish Commands

Run after authenticating npm:

```bash
npm login
npm publish --access public --workspace packages/core
npm publish --access public --workspace packages/cli
```

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
npx vsce publish --packagePath promptsonar-1.1.0.vsix
```

Verify Marketplace:

```bash
npx vsce show promptsonar-tools.promptsonar --json
```

## Post-Publish Evidence

After publish, update:

- `ADOPTION.md` Release Milestones table.
- `/evidence/` screenshots for npm and VS Code Marketplace `1.1.0`.
- `docs/task.md` publish checklist.

