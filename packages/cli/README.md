# @promptsonar/cli

CLI for PromptSonar: local-first static security scanning for AI prompts, agent instructions, MCP configs, and CI workflows.

```bash
npm install -g @promptsonar/cli
promptsonar scan .
```

No install:

```bash
npx @promptsonar/cli scan .
```

## Commands

```bash
promptsonar scan . --json
promptsonar scan . --sarif --output promptsonar.sarif
promptsonar audit-mcp
promptsonar sbom ./src --output prompt-sbom.json
promptsonar demo
```

## Repo Scan Behavior

Workspace scans are local and bounded for large repositories:

- Respects `.gitignore`.
- Respects `.promptsonarignore`.
- Skips common dependency, build, cache, coverage, docs, tests, benchmark, result, asset, map, and lockfile paths.
- Skips files larger than 1 MB by default.
- Caps scans at 2,000 files by default.
- Deduplicates repeated findings and summarizes noisy low-risk findings in reports.

Use `.promptsonarignore` for path-only exclusions:

```gitignore
examples/**
fixtures/vulnerable/**
results/**
```

Use `.promptsonar-waivers.yaml` or inline `promptsonar-ignore` comments for reviewed rule-specific suppressions.

## Notes

- Zero LLM calls.
- Runs locally.
- Maps supported security findings to OWASP LLM Top 10.
- Static-analysis findings are signals and require review.

Main documentation: https://github.com/meghal86/promptsonar
