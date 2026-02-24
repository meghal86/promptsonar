# PromptSonar

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/raj-promptsonar.promptsonar?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=raj-promptsonar.promptsonar)
[![GitHub stars](https://img.shields.io/github/stars/raj-promptsonar/promptsonar?style=social)](https://github.com/raj-promptsonar/promptsonar)

Static scanner for prompt injection (OWASP LLM01), API key leaks, and jailbreaks in code. Local, fast, no external LLM calls.

![CLI Scan Output](screenshot-cli-fail.png)

## Features
- **Auto-Detect Embedded Prompts**: Locates hardcoded LLM prompts in JavaScript, TypeScript, Python, Go, Java, Rust, c# and configuration files automatically.
- **Security Check (OWASP LLM01/LLM02)**: Instantly detects Prompt Injections, Developer Modes, role overrides, unicode/base64 obfuscation and exposes them.
- **CI/CD Gating**: Fails hard on Critical vulnerabilities to protect CI pipelines.
- **Live IDE Feedback**: Diagnostics live in your editor bridging directly into the exact same algorithmic rules engine powering the CLI.

![VS Code Hover](screenshot-vscode-squiggles.png)

## Install

### 1. VS Code Extension
Open VS Code → Extensions → Search "PromptSonar"

### 2. CLI Tool (Local Developer Usage)
```bash
# In the CLI directory
npm link ./packages/cli
promptsonar scan .
```

## Running Scans
```bash
# Scan a specific file or directory
promptsonar scan tests/validation/ultimate_injection_test.js

# Output report as JSON to parse programmatically
promptsonar scan . --json > report.json
```
