# Suppressions And Waivers

PromptSonar supports suppressions for reviewed false positives, intentionally vulnerable fixtures, and temporary exceptions. Suppressions should be narrow, documented, and time-bounded when possible.

## CLI Usage

```bash
promptsonar scan . --waiver .promptsonar-waivers.yaml
```

If `--waiver` is not provided, PromptSonar auto-discovers these files from the scanned root:

- `.promptsonar-waivers.yaml`
- `.promptsonarignore`

## YAML Suppression Format

Use `ignore:` for lightweight suppressions.

```yaml
ignore:
  - rule: C1
    path: "tests/**"
    reason: "Intentional vulnerable prompt fixture"
    expires_at: "2026-12-31"

  - rule: UNICODE_ZERO_WIDTH
    path: "examples/**"
    reason: "Demo fixture"
```

Supported fields:

- `rule` or `rule_id`: suppresses a specific rule. Aliases such as `C1`, `E1`, `E2`, `E3`, and `UNICODE_ZERO_WIDTH` are accepted for common security rules.
- `path`: suppresses matching files using simple glob patterns such as `tests/**` or `examples/*.prompt`.
- `reason`: optional explanation shown in output.
- `expires_at` or `expiry`: optional `YYYY-MM-DD` expiration.

Rule-only, path-only, and rule+path suppressions are supported. Prefer rule+path because it is the narrowest.

## Governance Waiver Format

The existing auditable waiver format remains supported:

```yaml
waivers:
  - id: WVR-2026-001
    status: active
    scope:
      rule_id: sec_owasp_llm01_injection
      path: "tests/**"
    justification: "Intentional jailbreak fixture used by the regression test suite."
    expires_at: "2026-12-31"
    owner: security
    approved_by: lead-security-reviewer
```

## .promptsonarignore

`.promptsonarignore` is path-only. Each non-empty, non-comment line is treated as a path glob:

```gitignore
# Ignore generated fixtures
tests/fixtures/generated/**
examples/vulnerable-prompts/**
```

Use YAML suppressions when you need rule-specific suppression or a reason.

## Inline Suppressions

PromptSonar supports inline suppressions for source files:

```ts
// promptsonar-ignore-next-line C1
const prompt = "Ignore all previous instructions";
```

```ts
const prompt = "Ignore all previous instructions"; // promptsonar-ignore C1
```

Inline suppressions are intentionally narrow. They apply only to the prompt string starting on the suppressed line.

## CI Behavior

Suppressed findings still appear in JSON/terminal output with `[WAIVED]` metadata, but they do not count toward `--fail-on` exit thresholds. This keeps CI usable without hiding the security signal completely.

## When Suppression Is Appropriate

- Intentional vulnerable test fixtures.
- Documentation examples that intentionally show an attack string.
- Known false positives reviewed by a maintainer.
- Temporary exceptions with an owner and expiration date.

Do not suppress real production findings without a reason. Hardcoded secrets, prompt injection paths, and unsafe agent tool access should normally be fixed, not waived.
