# PromptSonar Testing Guide

Use this guide before a release, before posting a public demo, and before sending PromptSonar to design partners.

## Full Feature Smoke Test

```bash
npm run smoke:features
```

This verifies:

- CLI version output.
- Prompt scan JSON output.
- Critical severity exit gating.
- HTML report generation.
- `SKILL.md` agent instruction scanning.
- Safe and vulnerable MCP audits.
- Prompt SBOM export.
- Article 19 export.
- Prompt unit tests.
- Prompt contract validation.
- Cross-model evaluation simulator.
- LLMLingua compression fallback.
- Repository self-scan exclusions for generated/test/docs artifacts.

## MCP Security Wedge

```bash
npm run benchmark:mcp
bash tests/runner/test_mcp_audit_exit_codes.sh
```

Expected result:

- Safe MCP configs return clean output.
- Vulnerable MCP configs trigger the expected MCP rule IDs.
- Critical MCP findings return exit code `3`.

## Playground Demo

Run the dashboard locally:

```bash
npm run dev --workspace packages/dashboard
```

Open:

```text
http://localhost:3000/playground
```

Use the playground for public demos on X or LinkedIn. For a repo-wide scan demo, use the CLI-generated HTML report rather than raw terminal output:

```bash
npm run build --workspace packages/core
npm run build --workspace packages/cli
node packages/cli/dist/cli.js scan . --report promptsonar-report.html
```

The default scanner excludes generated bundles, `.next`, test fixtures, documentation, evidence, benchmarks, lockfiles, and local scratch scripts so public screenshots focus on real source prompts.

## Release Verification

```bash
npm run release:hygiene
npm test --workspace packages/core
npm run build --workspaces --if-present
```
