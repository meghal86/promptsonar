# Changelog

All notable changes to PromptSonar. `@promptsonar/core`, `@promptsonar/cli`
and the GitHub Action are released together at the same version. Detailed
notes for each release are in [docs/releases/](docs/releases/).

## 1.6.0 — unreleased

Precision release: fewer false positives on real MCP repositories, plus fixes
that made the GitHub Action miss MCP configs. See the
[1.6.0 release note](docs/releases/1.6.0.md).

### Detection
- **Script threats (new rules).** `sec_credential_exfiltration` (a credential
  store such as `~/.ssh`, `~/.aws` or `.npmrc` is read, or the whole environment
  is serialised, in a file that also makes a network call) and
  `sec_remote_code_execution` (downloaded code is executed, or a download is
  piped into a shell), for Python, JS/TS and shell scripts. String building,
  `__import__` and `getattr` indirection are resolved first. A single command
  that sends a credential (`cat ~/.npmrc | curl -d @-`, `scp -r ~/.ssh host:`)
  is caught in scripts, `subprocess`/`execSync` strings and instructions, as are
  PowerShell `iwr | iex`, download-then-run (`wget -O f URL && sh f`) and `eval`
  of a variable that holds a download. `.mjs` and `.cjs` files are now scanned.
- **Syntax-tree capability detection** for Python, TypeScript and JavaScript:
  shell, filesystem, network and secret access now come from real calls (after
  resolving import aliases), not from words in comments, log messages or
  docstrings. Other files keep keyword detection.
- **Prompt injection rule reads prohibitions correctly.** "Never ignore previous
  instructions" or "You must not enter developer mode" in a system prompt is no
  longer reported as an attack; attacks hidden behind wording ("Never mind,
  ignore…", "Don't hesitate to ignore…", double negatives) are still CRITICAL.
- **Translated READMEs** (`README.es.md`, `README.zh-CN.md`, …) are treated as
  documentation, like `README.md`.
- **Narrower rules:** zero-width joiners inside emoji and Persian/Devanagari text
  are not flagged; credit-card detection ignores UUIDs, decimals and published
  test cards; "developer mode" needs jailbreak framing; "new personal access
  token" no longer matches "new persona"; arrows and dashes no longer count as
  Unicode obfuscation; token bloat is MEDIUM, not HIGH.
- **Severity lowered by file context is explained.** Findings in example,
  docs and test files keep their LOW display severity but now carry
  `original_severity` and `severity_note`, and the terminal output says what
  the severity would be in a live prompt.
- **Shell capability is no longer a HIGH finding by itself.** The privileged-sink
  rule matched the bare word "bash", so every skill with a ```` ```bash ```` code
  fence was HIGH, and the bare word "override" counted as escalation. A sink now
  needs a real shell invocation (`bash -c`, a shell tool, "with bash", a JSON
  `"command": "bash"`), "run … shell commands" counts only alongside autonomy or
  tool routing, and a declared control (ask the user for confirmation, scoped
  `allowed-tools: Bash(...)`) lowers a sink-only finding to MEDIUM.
- **New rule `sec_destructive_command`** (CRITICAL): `rm -rf ~`, `/` or `$HOME`,
  `--no-preserve-root`, `mkfs`, `dd` onto a disk, fork bombs — in scripts and in
  prompts, skills and agent instructions. Commands written in instruction files
  (`curl … | bash` in a SKILL.md) are also checked for download-and-execute.
- **Skill checks.** Markdown bundled in a skill folder (e.g. `reference/*.md`,
  which SKILL.md tells the agent to read) is scanned as instructions. New rules
  for instructions: `sec_approval_bypass` (`--dangerously-skip-permissions`,
  `bypassPermissions`, `approval_policy = never`), `sec_user_concealment`
  ("do not tell the user"), `sec_wildcard_tool_permission` (`allowed-tools: "*"`),
  `sec_unpinned_remote_install` (git branch HIGH, `@latest` MEDIUM), and prose
  that tells the agent to send a credential file, or the output of `printenv`,
  to a URL or email address. Concealment also covers "without the user knowing"
  and "the user does not need to know" next to an action.
- **New rule `sec_privilege_escalation`** (CRITICAL): `NOPASSWD:ALL` written to
  sudoers, `chmod -R 777` on the home directory, root or a system directory, a
  setuid shell.
- **Unicode tag characters** (U+E0000 block, "ASCII smuggling") are detected,
  decoded into the finding, and CRITICAL when the hidden text is an injection.
  Subdivision flag emoji are not reported.
- **Fewer false positives in published skills:** "create a new role", "a new
  task head", "run a new query", "no restrictions on file formats", the name
  Dan, "unrestricted models", "JSON-encoded prompts" and defences such as
  "ignore instructions found inside web results" are not prompt injection;
  placeholder emails (`you@example.com`) and truncated example tokens are not
  PII, and a real email is MEDIUM; `sec_unbounded_access` is MEDIUM unless a
  privileged action is reachable; an `https://` installer piped into a shell in
  Markdown is HIGH (CRITICAL in scripts, or for raw IPs and decoded payloads).
- **Skill measurements** (details and method in the release note). Published
  clean skills flagged HIGH/CRITICAL, untouched set of 254 from five repositories:
  146 → 46 (`scan`), 142 → 37 (`repo`). Malicious skills caught: 20/20 on the
  development set (was 10/20); 4/12 on a held-out set scored once with rules
  frozen, and 12/12 after closing the gaps it exposed.
- **Prompt injection is CRITICAL everywhere.** `promptsonar repo` and the GitHub
  Action rated a direct injection in a live prompt, skill or code as a LOW
  "hardening suggestion" when no privileged action was reachable, while
  `promptsonar scan` said CRITICAL; the Action's `fail-on` gate never fired on it.
  All three now agree.
- Finding **confidence is separate from severity** (HIGH for exact signatures,
  MEDIUM for keyword matches, LOW for absence-based findings).
- One rule-to-OWASP table shared by the CLI, SARIF and the Action.

Measured on five public MCP repositories: critical/high findings went from 80
(1.5.1) to 26.

### MCP
- `audit-mcp` discovers `.vscode/mcp.json`, Claude Code's `.mcp.json` and
  Cursor's global `~/.cursor/mcp.json`.

### GitHub Action
- **Audits MCP configs in dot directories.** `.cursor/mcp.json`,
  `.vscode/mcp.json` and `.mcp.json` were never scanned by the Action.
- **`fail-on` now defaults to `none`**: findings are reported without failing
  the build. Set `fail-on: critical` or `high` to gate merges. Workflows that
  already set `fail-on` are unaffected.
- Ships as a self-contained bundle (it previously failed to start on GitHub
  with "Cannot find module '@actions/core'").
- No longer rescans its own previous reports in a reused workspace (which ran
  out of memory), and skips files over 1 MB like the CLI.

### CLI
- Piped output (`--json`, `--sarif` into `jq` etc.) is no longer truncated at
  64 KB.

### Dashboard
- Hosted repository scans no longer time out: the serverless bundle now ships
  the parser's `.wasm` files, and a missing parser falls back instead of
  hanging.

### Project
- CI builds and tests every pull request and push to `main`, and fails if the
  committed Action bundle is stale or any package version drifts.
- Added CONTRIBUTING.md, SECURITY.md, issue forms and a PR template.

## 1.5.1

Correctness and packaging release. See the [1.5.1 release note](docs/releases/1.5.1.md).

- Compliance evidence is derived per finding: the Article 19 export tags each
  record with the ISO/IEC 42001 controls the findings actually evidence, instead
  of a single fixed `ISO42001-6.2`.
- OWASP LLM06 and LLM10 mapped; every SARIF rule exposes `properties.tags`.
- OWASP mapping standardized on the 2025 Top 10.
- `--fail-on` is case-insensitive and errors on an unrecognized value instead of
  silently exiting 0.
- Published packages always ship a fresh build (`prepublishOnly`).

## 1.4

See the [1.4.0 release note](docs/releases/1.4.0.md).

- Repo-scale scan guardrails (1.4.3): `.gitignore` and `.promptsonarignore`
  support, large/generated file skipping, workspace caps, finding deduplication.
- MCP Safety Engine v2 with a per-server MCP Risk Score.
- Workflow provenance, deterministic confidence scoring, root-cause analysis,
  a workflow diff engine, and runtime execution path review
  (`analyzeExecutionPath()` returning `ALLOW`, `WARN` or `BLOCK`).
