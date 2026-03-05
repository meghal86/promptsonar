// Test: Security documentation that mentions attack patterns
// This is our SECURITY.md equivalent — mentions jailbreaks for education

/**
 * PromptSonar detects the following attack patterns:
 * - "Ignore all previous instructions" (C1 — Jailbreak Reset)
 * - "Act as DAN" (C2 — Jailbreak Mode)
 * - "sk-" prefixed API keys (C3 — Key Exposure)
 *
 * These patterns are documented for educational purposes only.
 */

const KNOWN_ATTACK_PATTERNS = [
  "Ignore all previous instructions",  // should NOT flag — in a string array for reference
  "Act as DAN",
  "Developer mode"
];
// EXPECTED: 0 findings (strings in documentation/config arrays, not in LLM calls)
// DECISION POINT: Does scanner flag strings even outside of LLM call context?
// Document expected behavior clearly.