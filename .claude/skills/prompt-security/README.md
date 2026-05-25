# PromptSonar for Claude Code

Auto-scan prompts before execution.

## Install

```bash
npm install -g @promptsonar/cli
```

## Use in Claude Code

Claude Code auto-detects this skill in `.claude/skills/`.

When you open or edit a prompt file, use this skill to scan locally before execution.

## Manual Scan

```bash
claude scan-prompt ./src/prompts/customer.ts
```

## Reference

- Standard: https://github.com/meghal86/promptsonar#7-factor-standard
- Scanner: https://github.com/meghal86/promptsonar
