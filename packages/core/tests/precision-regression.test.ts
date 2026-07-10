import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { detectSensitiveActions } from '../src/repository/analyzer';
import { checkWorkflowEscalation } from '../src/rules/security/workflow_escalation';
import { scanContentForSecrets } from '../src/rules/security/pii';

// Regression for two precision false-positive classes found in the wild-corpus
// re-audit after the discovery-layer fix:
//   Cluster 1 — security rules (sec_privileged_sink_access / sec_mcp_tool_poisoning)
//     firing on prose inside docstrings/comments that merely MENTION a privileged
//     action ("this function does NOT execute bash", a config-field docstring).
//   Cluster 2 — sink-type inference mislabeling a path's terminal action from a
//     bare keyword: LLM "tokens" / a control "cancellation_token" -> Secrets; a
//     name-validator or PII-redactor -> External APIs.
//
// These assertions exercise the rule/classification FUNCTIONS directly — the unit
// under change — because the repo pipeline does not classify these minimal files
// as executor artifacts, so a whole-repo scan cannot reach the sink-labeling or
// rule logic (same reason the false-positive-regression suite tests the rule
// functions directly). Fixtures are the exact reductions of the audited FPs.

const DIR = path.resolve(__dirname, '../test/fixtures/precision-regression');
const read = (name: string) => fs.readFileSync(path.join(DIR, name), 'utf8');

const escalationSinkFindings = (text: string): string[] =>
    checkWorkflowEscalation({ text } as any)
        .map(f => f.rule_id)
        .filter(id => id === 'sec_privileged_sink_access' || id === 'sec_mcp_tool_poisoning');

describe('precision regression (docstring/comment gating + sink-label attribution)', () => {
    // Cluster 1
    it('does not flag a privileged action described only in a docstring', () => {
        expect(escalationSinkFindings(read('docstring-mention.py'))).toHaveLength(0);
    });

    it('STILL flags a real sink written as executable code (not a comment)', () => {
        // Positive control: comment-stripping must not suppress real sinks.
        expect(escalationSinkFindings('subprocess.run(cmd, shell=True)  # run any shell commands\nexecute any shell commands').length)
            .toBeGreaterThanOrEqual(1);
    });

    // Cluster 2 — Secrets must require a credential-shaped identifier, not bare "token"
    it('does not label LLM max_tokens / token_limit as a Secrets sink', () => {
        expect(detectSensitiveActions(read('max-tokens-not-secret.ts'))).not.toContain('Secrets');
    });

    it('does not label a "memory" class as a Secrets sink', () => {
        expect(detectSensitiveActions(read('memory-class-not-secret.py'))).not.toContain('Secrets');
    });

    it('does not label a control token (cancellation_token) as a Secrets sink', () => {
        // The exact wild false positive: `cancellation_token: CancellationToken`.
        expect(detectSensitiveActions('cancellation_token: CancellationToken | None = None')).not.toContain('Secrets');
    });

    // Cluster 2 — External API must require an actual outbound-call idiom
    it('does not label a name-validator as an External API sink', () => {
        expect(detectSensitiveActions(read('name-validator-not-network.ts'))).not.toContain('External APIs');
    });

    it('does not label a PII-redactor as an External API sink', () => {
        expect(detectSensitiveActions(read('pii-redactor-not-network.ts'))).not.toContain('External APIs');
    });

    // Must NOT regress: real credential and real network call still detected
    it('STILL detects a real hardcoded secret', () => {
        const content = read('real-secret-still-fires.ts');
        expect(scanContentForSecrets(content, path.join(DIR, 'real-secret-still-fires.ts')).length).toBeGreaterThanOrEqual(1);
        expect(detectSensitiveActions(content)).toContain('Secrets');
    });

    it('STILL labels a real fetch() call as an External API sink', () => {
        expect(detectSensitiveActions(read('real-network-call-still-fires.ts'))).toContain('External APIs');
    });
});
