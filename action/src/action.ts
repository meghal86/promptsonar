import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { scanFiles, generateSarif, ScanResult } from './scanner-bridge';

// ── PR Comment Template ─────────────────────────────────────

function buildPrComment(results: ScanResult[], sha: string, branch: string, repo: string): string {
    let totalCriticals = 0;
    let totalHighs = 0;
    let totalMediums = 0;
    let bestScore = 100;

    for (const r of results) {
        if (r.overall_score < bestScore) bestScore = r.overall_score;
        for (const f of r.findings) {
            if (f.waived) continue;
            if (f.severity === 'critical') totalCriticals++;
            else if (f.severity === 'high') totalHighs++;
            else if (f.severity === 'medium') totalMediums++;
        }
    }

    const critStatus = totalCriticals > 0 ? '❌ Blocked' : '✅ Pass';
    const highStatus = totalHighs > 0 ? '⚠️ Review' : '✅ Pass';

    let comment = `## 🔍 PromptSonar — Prompt Security Scan\n\n`;
    comment += `**Score: ${bestScore}/100** | Commit: ${sha.substring(0, 7)} | Branch: ${branch}\n\n`;
    comment += `| Severity | Found | Status |\n`;
    comment += `|----------|-------|--------|\n`;
    comment += `| 🔴 Critical | ${totalCriticals} | ${critStatus} |\n`;
    comment += `| 🟠 High     | ${totalHighs} | ${highStatus} |\n`;
    comment += `| 🟡 Medium   | ${totalMediums} | ℹ️ Info |\n\n`;

    // Per-finding blocks
    for (const r of results) {
        for (const f of r.findings) {
            if (f.waived) continue;
            const sevLabel = f.severity.toUpperCase();
            comment += `**${sevLabel}** — \`${f.rule_id}\`\n`;
            comment += `File: \`${r.filePath}:${f.line}\`\n`;
            comment += `Fix: ${f.fix}\n\n`;
        }
    }

    comment += `🔗 [View in GitHub Security](https://github.com/${repo}/security/code-scanning)\n`;

    return comment;
}

// ── Main Action ─────────────────────────────────────────────

async function run(): Promise<void> {
    try {
        const failOn = core.getInput('fail-on') || 'critical';
        const waiverFile = core.getInput('waiver-file') || '.promptsonar-waivers.yaml';
        const uploadSarif = core.getInput('upload-sarif') === 'true';
        const diffOnly = core.getInput('diff-only') === 'true';

        // Scan the workspace
        const workspace = process.env.GITHUB_WORKSPACE || '.';
        const results = await scanFiles(workspace, {
            verbose: false,
            diffOnly,
            waiverFile: fs.existsSync(waiverFile) ? waiverFile : undefined,
        });

        // Calculate metrics
        let worstScore = 100;
        let totalCriticals = 0;
        let totalHighs = 0;

        for (const r of results) {
            if (r.overall_score < worstScore) worstScore = r.overall_score;
            for (const f of r.findings) {
                if (f.waived) continue;
                if (f.severity === 'critical') totalCriticals++;
                else if (f.severity === 'high') totalHighs++;
            }
        }

        // Set outputs
        core.setOutput('score', worstScore.toString());
        core.setOutput('criticals', totalCriticals.toString());
        core.setOutput('highs', totalHighs.toString());

        // Generate and write SARIF
        const sarifPath = path.join(workspace, 'promptsonar-results.sarif');
        const sarifContent = generateSarif(results);
        fs.writeFileSync(sarifPath, sarifContent, 'utf-8');
        core.setOutput('sarif-path', sarifPath);

        // Upload SARIF if requested
        if (uploadSarif) {
            core.info(`SARIF written to ${sarifPath}. Upload to GitHub Security tab via github/codeql-action/upload-sarif.`);
        }

        // Post PR comment
        const context = github.context;
        if (context.payload.pull_request) {
            const token = process.env.GITHUB_TOKEN;
            if (token) {
                const octokit = github.getOctokit(token);
                const repo = `${context.repo.owner}/${context.repo.repo}`;
                const sha = context.payload.pull_request.head.sha || context.sha;
                const branch = context.payload.pull_request.head.ref || '';

                const body = buildPrComment(results, sha, branch, repo);

                await octokit.rest.issues.createComment({
                    ...context.repo,
                    issue_number: context.payload.pull_request.number,
                    body,
                });

                core.info('PR comment posted successfully.');
            } else {
                core.warning('GITHUB_TOKEN not available. Skipping PR comment.');
            }
        }

        // Determine exit
        const severityOrder = ['critical', 'high', 'medium', 'low', 'none'];
        const failOnIndex = severityOrder.indexOf(failOn);

        if (totalCriticals > 0 && failOnIndex <= 0) {
            core.setFailed(`PromptSonar: ${totalCriticals} critical finding(s) detected. Score: ${worstScore}/100`);
        } else if (totalHighs > 0 && failOnIndex <= 1) {
            core.setFailed(`PromptSonar: ${totalHighs} high finding(s) detected. Score: ${worstScore}/100`);
        }

    } catch (error: any) {
        core.setFailed(`PromptSonar Action failed: ${error.message}`);
    }
}

run();
