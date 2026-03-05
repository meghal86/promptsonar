// Validates that --json output matches expected schema

const { execSync } = require('child_process');
const assert = require('assert');

function scanFile(filePath) {
  const output = execSync(`promptsonar scan ${filePath} --json`).toString();
  return JSON.parse(output);
}

// Schema every JSON output MUST match:
const EXPECTED_SCHEMA = {
  // Required top-level fields:
  version: 'string',          // CLI version e.g. "0.1.0"
  scanned_at: 'string',       // ISO 8601 timestamp
  file: 'string',             // Path scanned
  overall_score: 'number',    // 0-100
  findings_count: 'number',
  findings: 'array',          // Array of Finding objects

  // Each finding must have:
  finding: {
    rule_id: 'string',        // e.g. "C1", "H2", "C3"
    severity: 'string',       // "critical" | "high" | "medium" | "low"
    line: 'number',           // 1-indexed line number
    column: 'number',         // 1-indexed column
    message: 'string',        // Human-readable description
    fix: 'string',            // Suggested fix
    owasp_ref: 'string',      // e.g. "LLM01" or "LLM02"
  }
};

// Tests:
describe("JSON output schema", () => {
  it("should produce valid JSON for a file with findings", () => {
    const result = scanFile("should_flag/c1_jailbreak_reset_basic.ts");
    assert.strictEqual(typeof result.overall_score, 'number');
    assert.ok(result.findings.length > 0);
    assert.ok(result.findings[0].rule_id);
    assert.ok(result.findings[0].line > 0);
  });

  it("should produce valid JSON for a clean file", () => {
    const result = scanFile("should_not_flag/fp_imports_and_boilerplate.ts");
    assert.strictEqual(result.findings_count, 0);
    assert.strictEqual(result.findings.length, 0);
    assert.strictEqual(result.overall_score, 100);
  });

  it("should always include version and timestamp", () => {
    const result = scanFile("should_flag/c2_dan_classic.ts");
    assert.ok(result.version);
    assert.ok(result.scanned_at);
    assert.ok(new Date(result.scanned_at).getTime() > 0); // valid date
  });
});