# PromptSonar for Cursor

See where your prompt goes before it reaches tools, memory, MCP servers, shell execution, filesystem access, or network actions.

PromptSonar brings Execution Path Analysis directly into Cursor. Instead of only reporting findings, PromptSonar shows:

- The execution path
- Why the path exists
- Evidence supporting the path
- Confidence in the path
- Root cause analysis
- Workflow replay
- Workflow diff after remediation

Everything runs locally.
No LLM calls.
No telemetry.
No cloud services.
No prompt uploads.

## What Makes PromptSonar Different

Most AI security tools tell you something is risky.

PromptSonar shows how untrusted input can travel through an AI system.

Example:

```text
USER INPUT
↓
MCP SERVER
↓
PRIVILEGED TOOL
↓
SHELL EXECUTION
```

Then explains:

- Evidence
- Confidence
- Root Cause
- Replay Timeline
- Workflow Diff
- Risk Reduction

The goal is not just detection. The goal is understanding why a path exists and proving that it has been removed.

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
