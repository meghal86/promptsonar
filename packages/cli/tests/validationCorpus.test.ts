import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanFiles } from '../src/scanner';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VALIDATION_ROOT = path.join(REPO_ROOT, 'tests', 'validation');
const GOLDEN_ROOT = path.join(REPO_ROOT, 'tests', 'golden', 'fixtures');

// Documented detection gaps. These entries keep the corpus honest: removing a
// fixed gap from a list without the corresponding detection improvement (or
// adding a new one) fails CI instead of silently shifting behavior.
const KNOWN_FALSE_NEGATIVES = new Set([
    'c1_new_session.js',
    'c1_multilingual_reset.ts',
    // No literal secret exists in source: the value is supplied at runtime
    // through interpolation (`${process.env.OPENAI_API_KEY}`,
    // `${user.cardNumber}`). There is nothing to statically detect — flagging
    // these would require taint analysis, and the env-var form is the safe
    // pattern. Documented, not silently missed.
    'c3_env_var_interpolation.ts',
    'c4_pii_template_passthrough.ts',
    'string_splitting.ts',
]);
const KNOWN_FALSE_POSITIVES = new Set([
    'fp_documentation_file.ts',
    'fp_test_file_itself.ts',
]);

async function securityFindingCounts(dir: string): Promise<Map<string, number>> {
    const results = await scanFiles(dir, {});
    const counts = new Map<string, number>();
    for (const file of fs.readdirSync(dir)) {
        if (!fs.statSync(path.join(dir, file)).isFile()) continue;
        counts.set(file, 0);
    }
    for (const result of results) {
        counts.set(
            path.basename(result.filePath),
            result.findings.filter(finding => !finding.waived && finding.category === 'security').length,
        );
    }
    return counts;
}

describe('validation corpus (golden behavior)', () => {
    it('flags every should_flag fixture except documented false negatives', async () => {
        const counts = await securityFindingCounts(path.join(VALIDATION_ROOT, 'security', 'should_flag'));
        for (const [file, count] of counts) {
            if (KNOWN_FALSE_NEGATIVES.has(file)) {
                expect(count, `${file} is a documented false negative; if it now flags, remove it from KNOWN_FALSE_NEGATIVES`).toBe(0);
            } else {
                expect(count, `${file} must produce at least one security finding`).toBeGreaterThan(0);
            }
        }
    });

    it('keeps should_not_flag fixtures clean except documented false positives', async () => {
        const counts = await securityFindingCounts(path.join(VALIDATION_ROOT, 'security', 'should_not_flag'));
        for (const [file, count] of counts) {
            if (KNOWN_FALSE_POSITIVES.has(file)) {
                expect(count, `${file} is a documented false positive; if it is now clean, remove it from KNOWN_FALSE_POSITIVES`).toBeGreaterThan(0);
            } else {
                expect(count, `${file} must stay clean`).toBe(0);
            }
        }
    });

    it('flags every evasion fixture except documented false negatives', async () => {
        const counts = await securityFindingCounts(path.join(VALIDATION_ROOT, 'evasion'));
        for (const [file, count] of counts) {
            if (KNOWN_FALSE_NEGATIVES.has(file)) {
                expect(count).toBe(0);
            } else {
                expect(count, `${file} must produce at least one security finding`).toBeGreaterThan(0);
            }
        }
    });
});

describe('golden fixtures', () => {
    it('benign MCP server produces no critical or high findings', async () => {
        const results = await scanFiles(path.join(GOLDEN_ROOT, 'benign-mcp'), {});
        const severe = results.flatMap(result => result.findings).filter(finding =>
            !finding.waived && (finding.severity === 'critical' || finding.severity === 'high'));
        expect(severe).toHaveLength(0);
    });

    it('dangerous MCP server produces critical shell and approval-bypass findings', async () => {
        const results = await scanFiles(path.join(GOLDEN_ROOT, 'dangerous-mcp'), {});
        const ruleIds = results.flatMap(result => result.findings).map(finding => finding.rule_id);
        expect(ruleIds).toContain('MCP-104');
        expect(ruleIds).toContain('MCP-108');
    });

    it('memory persistence risk in a prompt reaches the workflow escalation rule', async () => {
        const results = await scanFiles(GOLDEN_ROOT, {});
        const memory = results.find(result => result.filePath.endsWith('memory-write-risk.prompt'));
        expect(memory?.findings.some(finding => finding.rule_id === 'sec_workflow_escalation' && finding.severity === 'critical')).toBe(true);
    });

    it('documents the SKILL.md boundary gap: no skill-boundary rule exists yet', async () => {
        // A skill granting deploy/restart/credential capabilities with no
        // constraints produces no skill-specific finding today. This test
        // documents the gap; when a skill-boundary rule lands, update it.
        const results = await scanFiles(path.join(GOLDEN_ROOT, 'skills'), {});
        const skillRules = results.flatMap(result => result.findings).filter(finding => finding.rule_id.startsWith('skill_'));
        expect(skillRules).toHaveLength(0);
    });

    it('documents that YAML MCP configs are not audited (unsupported)', async () => {
        // mcp.yaml is classified as a repository artifact but the MCP auditor
        // only parses JSON. This test documents that limitation explicitly.
        const results = await scanFiles(GOLDEN_ROOT, {});
        const yamlResult = results.find(result => result.filePath.endsWith('mcp.yaml'));
        const mcpFindings = (yamlResult?.findings || []).filter(finding => finding.rule_id.startsWith('MCP-'));
        expect(mcpFindings).toHaveLength(0);
    });
});
