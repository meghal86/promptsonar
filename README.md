# PromptSonar

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/promptsonar-tools.promptsonar?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar)
[![GitHub stars](https://img.shields.io/github/stars/meghal-promptsonar/promptsonar?style=social)](https://github.com/meghal-promptsonar/promptsonar)

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

## VS Code Extension Features

Once the PromptSonar extension is installed, you can scan your code seamlessly from within the editor. 
**Note:** These commands are run from the VS Code **Command Palette**, NOT your terminal.

- **Run Health Check:** 
  You can click the `▶ Run PromptSonar Health Check` **CodeLens** that appears directly above any detected prompt, or use the play button in the Editor Title Menu.
- **Scan Entire Workspace:** 
  Open the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`), type **`PromptSonar: Scan Entire Workspace`**, and hit Enter. This will scan all supported files in your project and generate a master HTML security report.
- **Configuration:** 
  If you find the CodeLenses visually distracting while typing, you can disable them by searching for `promptsonar.enableCodeLens` in your VS Code settings.

## Running Scans (CLI Tool)
```bash
# Scan a specific file or directory
promptsonar scan tests/validation/ultimate_injection_test.js

# Output report as JSON to parse programmatically
promptsonar scan . --json > report.json
```

## Known Limitations — v0.1.0

**Static analysis constraints (shared by Snyk, SonarQube, ESLint):**

1. **Concatenated string assembly**
   `const a = "Ignore "; const p = a + "previous instructions";`
   → Each fragment scanned separately. Scheduled: v0.2.0.

2. **Non-English jailbreaks**
   Spanish, French, German, Arabic injection patterns not covered.
   → Multilingual rule pack: v0.2.0.

3. **Runtime-constructed prompts**
   Values fetched from a database or API at runtime cannot be statically analyzed.
   → PromptSonar Runtime SDK: Phase 4.

4. **Deep function indirection**
   `const getPrompt = () => JAILBREAK; usePrompt(getPrompt())`
   → Direct assignments and inline template literals only in v0.1.0.

5. **Token compression**
   LLMLingua-2 engine is built. License for production use pending.
   → Coming in a future release.

**Evasion — verified results:**
- Base64 encoded jailbreaks:       DETECTED ✅ (decoded before pattern match)
- Cyrillic homoglyph substitution: DETECTED ✅ (normalized before pattern match)
- Mathematical Unicode symbols:    DETECTED ✅ (U+1D400–U+1D7FF range check)
- Zero-width character injection:  DETECTED ✅ (stripped before pattern match)
