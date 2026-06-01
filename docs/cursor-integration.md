# PromptSonar Cursor Integration

PromptSonar for Cursor runs local execution-path analysis inside Cursor before prompts, MCP configs, or agent instructions reach tools, memory, shell execution, filesystem access, or network actions.

It reuses `@promptsonar/core` and the existing VS Code shared detection, model, and quick-fix helpers. It does not duplicate scanner logic, call LLMs, send telemetry, or use cloud services.

## Installation

Build the Cursor extension package locally:

```bash
npm run build --workspace packages/cursor-extension
```

The extension entry point is:

```text
packages/cursor-extension/dist/extension.js
```

## Supported Files

Live analysis runs on:

- `.prompt`
- `.md`
- `.txt`
- `.yaml`
- `.yml`
- `.json`
- `mcp.json`
- agent configs and system prompt files

Cursor analysis uses a 300ms debounce and a 1MB file-size guard by default.

## Commands

- `PromptSonar: Scan Current File`
- `PromptSonar: Open Execution Path`
- `PromptSonar: Show Workflow Replay`
- `PromptSonar: Show Workflow Diff`
- `PromptSonar: Apply Fix + Show Workflow Diff`
- `PromptSonar: Export SARIF`
- `PromptSonar: Copy Report`
- `PromptSonar: Open Playground`

## Sidebar

The `PromptSonar Execution Path` sidebar shows the selected file's execution path, evidence, confidence, root cause, workflow diff, and workflow replay using existing workflow provenance and runtime metadata.

## Quick Fixes

Quick fixes are deterministic local rewrites:

- Replace wildcard permissions.
- Disable `autoExecute`.
- Move credentials to environment variables.
- Treat user input as untrusted.
- Add an approval boundary before tool execution.

After applying fixes, Cursor can open a workflow diff showing whether the execution path was removed and the risk-reduction percentage.

## Limitations

PromptSonar for Cursor is a static local analyzer. It does not execute prompts, call model APIs, observe runtime traffic, or upload files.

