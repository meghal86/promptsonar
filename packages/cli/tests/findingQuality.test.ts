import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeRepositoryExecution } from '@promptsonar/core';
import { scanFiles } from '../src/scanner';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-finding-quality-'));
}

function writeFile(root: string, relativePath: string, content: string): string {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}

const qualityPrefixes = ['bp_', 'clarity_', 'struct_', 'consist_', 'eff_'];

describe('artifact-aware finding quality', () => {
    it('keeps workflow findings workflow-specific and evidence-backed', async () => {
        const root = makeTempDir();
        const workflowPath = writeFile(root, '.github/workflows/release-macos.yml', [
            'name: Release macOS',
            'on:',
            '  pull_request:',
            '  workflow_dispatch:',
            'permissions: write-all',
            'jobs:',
            '  release:',
            '    runs-on: macos-latest',
            '    steps:',
            '      - uses: actions/checkout@v4',
            '      - name: Build notarized release',
            '        env:',
            '          GITHUB_TOKEN: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            '        run: |',
            '          sh -c "./scripts/release-macos.sh ${{ github.event.pull_request.title }}"',
        ].join('\n'));

        const findings = (await scanFiles(workflowPath, {})).flatMap(result => result.findings);
        const secretFinding = findings.find(finding => finding.rule_id === 'sec_owasp_llm02_pii');

        expect(findings.some(finding => qualityPrefixes.some(prefix => finding.rule_id.startsWith(prefix)))).toBe(false);
        expect(secretFinding).toMatchObject({ artifactKind: 'workflow', executionIntent: 'executable', line: 13 });
        expect(secretFinding?.message).toContain('workflow YAML');
        expect(secretFinding?.why).toContain('workflow YAML');
        expect(secretFinding?.evidence).toContain('GITHUB_TOKEN');
        expect(secretFinding?.fix).toContain('Restrict workflow permissions');
        expect(secretFinding?.fix).toContain('pin actions');
        expect(secretFinding?.fix).not.toMatch(/rag|token.?bloat|compress|prompt template/i);
    });

    it('gates prompt-quality findings by execution intent and quality context', async () => {
        const root = makeTempDir();
        const referencePrompt = writeFile(root, 'docs/prompt.md', [
            'You are a documentation example.',
            'Analyze the release plan and return a recommendation.',
        ].join('\n'));
        const executablePrompt = writeFile(root, 'prompt.md', [
            'Analyze the deployment plan, compare operational risks, delegate follow-up tasks, and return the rollout decision.',
        ].join('\n'));
        const simplePrompt = writeFile(root, 'simple.prompt', 'Summarize the support ticket in three bullets.');

        const referenceFindings = (await scanFiles(referencePrompt, {})).flatMap(result => result.findings);
        const executableFindings = (await scanFiles(executablePrompt, {})).flatMap(result => result.findings);
        const simpleFindings = (await scanFiles(simplePrompt, {})).flatMap(result => result.findings);

        expect(referenceFindings.some(finding => qualityPrefixes.some(prefix => finding.rule_id.startsWith(prefix)))).toBe(false);
        expect(executableFindings.some(finding => finding.rule_id === 'bp_missing_cot')).toBe(true);
        expect(simpleFindings.some(finding => finding.rule_id === 'bp_missing_cot')).toBe(false);
        expect(simpleFindings.some(finding => finding.rule_id === 'bp_missing_few_shot')).toBe(false);
    });

    it('treats research compatibility markdown as reference material unless execution-linked', async () => {
        const root = makeTempDir();
        const researchPath = writeFile(root, 'research/tool-compatibility-matrix.md', [
            '# Tool compatibility matrix',
            '',
            '| Tool | Prompt support | Notes |',
            '| --- | --- | --- |',
            '| Release bot | sample prompt only | Tutorial reference, not production instructions. |',
            '',
            'Analyze the deployment plan and return every compatibility issue for the table.',
        ].join('\n'));

        const findings = (await scanFiles(researchPath, {})).flatMap(result => result.findings);

        expect(findings.some(finding => qualityPrefixes.some(prefix => finding.rule_id.startsWith(prefix)))).toBe(false);
        expect(findings.every(finding => finding.executionIntent === 'reference')).toBe(true);
    });

    it('uses agent-specific remediation for AGENTS.md and keeps security above quality', async () => {
        const root = makeTempDir();
        const agentsPath = writeFile(root, 'AGENTS.md', [
            'Analyze repository changes, plan fixes, delegate work, and execute shell commands when useful.',
            'Use token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa for publishing.',
        ].join('\n'));

        const findings = (await scanFiles(agentsPath, {})).flatMap(result => result.findings);
        const secretFinding = findings.find(finding => finding.rule_id === 'sec_owasp_llm02_pii');
        const qualityFinding = findings.find(finding => finding.rule_id === 'bp_missing_cot');

        expect(findings[0].category).toBe('security');
        expect(secretFinding).toMatchObject({ artifactKind: 'agents', executionIntent: 'executable' });
        expect(secretFinding?.message).toContain('AGENTS.md agent instruction file');
        expect(secretFinding?.why).toContain('agent instruction');
        expect(secretFinding?.fix).toContain('agent instructions');
        expect(secretFinding?.fix).not.toMatch(/rag|token.?bloat|prompt template/i);
        expect(qualityFinding?.fix).toContain('agent instruction');
    });

    it('allows prompt-quality cards for executable CLAUDE.md instructions', async () => {
        const root = makeTempDir();
        const claudePath = writeFile(root, 'CLAUDE.md', [
            'Analyze repository changes, plan fixes, delegate work, and execute shell commands when useful.',
            'Return every issue you find across all files.',
        ].join('\n'));

        const findings = (await scanFiles(claudePath, {})).flatMap(result => result.findings);

        expect(findings.some(finding => finding.artifactKind === 'claude' && finding.executionIntent === 'executable')).toBe(true);
        expect(findings.some(finding => finding.rule_id === 'bp_missing_cot')).toBe(true);
        expect(findings.some(finding => finding.rule_id === 'clarity_missing_quantifier')).toBe(true);
    });

    it('renders artifact-shaped safe patterns for CLAUDE.md, AGENTS.md, SKILL.md, workflow, and prompt.md', () => {
        const root = makeTempDir();
        const scanResults = [
            {
                filePath: writeFile(root, 'CLAUDE.md', 'Analyze code and execute shell commands.'),
                findings: [{ rule_id: 'sec_workflow_escalation', category: 'security', severity: 'high', line: 1, message: 'Shell access.', evidence: 'execute shell commands', artifactKind: 'claude', executionIntent: 'executable' }],
            },
            {
                filePath: writeFile(root, 'AGENTS.md', 'Analyze code and execute shell commands.'),
                findings: [{ rule_id: 'bp_missing_cot', category: 'best_practices', severity: 'low', line: 1, message: 'Missing verification.', evidenceKind: 'absence', missingRequirement: 'No verification criteria.', artifactKind: 'agents', executionIntent: 'executable' }],
            },
            {
                filePath: writeFile(root, 'skills/release/SKILL.md', 'Use shell for releases.'),
                findings: [{ rule_id: 'sec_workflow_escalation', category: 'security', severity: 'high', line: 1, message: 'Shell access.', evidence: 'Use shell', artifactKind: 'skill', executionIntent: 'executable' }],
            },
            {
                filePath: writeFile(root, '.github/workflows/release-macos.yml', 'env:\n  GITHUB_TOKEN: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
                findings: [{
                    rule_id: 'sec_owasp_llm02_pii',
                    category: 'security',
                    severity: 'high',
                    line: 2,
                    message: 'Secret.',
                    evidence: 'GITHUB_TOKEN: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    fix: 'Shorten the prompt or rely on RAG.',
                    artifactKind: 'workflow',
                    executionIntent: 'executable',
                }],
            },
            {
                filePath: writeFile(root, 'prompt.md', 'Generate a rollout recommendation.'),
                findings: [{ rule_id: 'bp_missing_persona', category: 'best_practices', severity: 'low', line: 1, message: 'Missing persona.', evidenceKind: 'absence', missingRequirement: 'No bounded role.', artifactKind: 'prompt', executionIntent: 'executable' }],
            },
        ];

        const report = analyzeRepositoryExecution(root, scanResults as any);
        const byFile = new Map(report.issues.map(issue => [issue.impactedFiles[0], issue]));

        expect(byFile.get('CLAUDE.md')?.fix.safePattern).toContain('# CLAUDE.md');
        expect(byFile.get('AGENTS.md')?.fix.safePattern).toContain('# AGENTS.md');
        expect(byFile.get('skills/release/SKILL.md')?.fix.safePattern).toContain('# SKILL.md');
        expect(byFile.get('.github/workflows/release-macos.yml')?.fix.safePattern).toContain('permissions: { contents: read }');
        expect(byFile.get('.github/workflows/release-macos.yml')?.fix.recommendedFix).toContain('workflow');
        expect(byFile.get('.github/workflows/release-macos.yml')?.fix.recommendedFix).not.toMatch(/rag|token|compress|shorten the prompt/i);
        expect(byFile.get('prompt.md')?.fix.safePattern).toContain('bounded role');
        expect(report.executiveSummary?.highestPriorityFindings[0].ruleId).toMatch(/^sec_/);
    });

    it('keeps repository map counts and evidence ownership internally consistent', () => {
        const root = makeTempDir();
        const workflowPath = writeFile(root, '.github/workflows/release-macos.yml', [
            'name: release',
            'jobs:',
            '  release:',
            '    steps:',
            '      - run: echo "$TOKEN"',
            '        env:',
            '          TOKEN: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ].join('\n'));
        const agentsPath = writeFile(root, 'AGENTS.md', [
            'Analyze repository changes, plan fixes, delegate work, and execute shell commands when useful.',
            'Return every issue you find across all files.',
        ].join('\n'));
        writeFile(root, 'research/tool-compatibility-matrix.md', [
            '# Tool compatibility matrix',
            'This reference describes prompt support across tools.',
        ].join('\n'));
        const scanResults = [
            {
                filePath: workflowPath,
                findings: [{ rule_id: 'sec_owasp_llm02_pii', category: 'security', severity: 'high', line: 7, message: 'Hardcoded token.', evidence: 'TOKEN: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', artifactKind: 'workflow', executionIntent: 'executable' }],
            },
            {
                filePath: agentsPath,
                findings: [{ rule_id: 'bp_missing_cot', category: 'best_practices', severity: 'low', line: 1, message: 'Missing verification.', evidenceKind: 'absence', missingRequirement: 'No verification criteria.', artifactKind: 'agents', executionIntent: 'executable' }],
            },
        ];

        const report = analyzeRepositoryExecution(root, scanResults as any);
        const countedIssues = report.issueSummary.critical + report.issueSummary.high + report.issueSummary.medium + report.issueSummary.low;

        expect(report.issueSummary.total).toBe(report.issues.length);
        expect(countedIssues).toBe(report.issues.length);
        expect(report.summary.reachablePaths).toBe(report.reachablePaths.length);
        expect(report.summary.executionGraph.nodes).toBe(report.executionMap.nodes.length);
        expect(report.summary.executionGraph.edges).toBe(report.executionMap.edges.length);
        for (const file of report.impactedFiles) {
            const ownedIssues = report.issues.filter(issue => issue.impactedFiles.includes(file.path));
            expect(file.issueCount).toBe(ownedIssues.length);
            expect(file.issueIds.sort()).toEqual(ownedIssues.map(issue => issue.id).sort());
        }
        for (const issue of report.issues) {
            for (const evidence of issue.evidence) {
                expect(issue.impactedFiles).toContain(evidence.file);
                expect(evidence.snippet || evidence.missingRequirement).toBeTruthy();
            }
        }
        expect(report.pathValidation.valid).toBe(true);
        expect(report.artifacts.some(artifact => artifact.relativePath === 'research/tool-compatibility-matrix.md' && artifact.type === 'PROMPT')).toBe(false);
    });
});
