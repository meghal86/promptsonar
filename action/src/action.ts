import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
    analyzeRootCause,
    analyzeRepositoryExecution,
    auditMcpConfig,
    buildPrReviewSummaryMarkdown,
    computeWorkflowDiff,
    evaluatePrReviewGates,
    extractChangedLinesFromGitHubPatch,
    formatRepositoryReportHtml,
    formatRepositoryReportJson,
    formatRepositoryReportSarif,
    humanRuleName,
    parsePromptSonarPrReviewConfig,
    pathToGraph,
    type Finding,
    type PromptSonarPrReviewConfig,
    type WorkflowDiff,
    workflowPathSummary,
} from '@promptsonar/core';
import { ScanResult, scanFileContent, scanFiles } from './scanner-bridge';

type GitHubPullRequestEvent = {
    pull_request?: {
        number: number;
        base?: { sha?: string; ref?: string };
        head?: { sha?: string; ref?: string };
    };
    repository?: { full_name?: string };
};

type PullFile = {
    filename: string;
    status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | string;
    patch?: string;
    previous_filename?: string;
};

const PR_REVIEW_MARKER = '<!-- PROMPTSONAR_PR_REVIEW -->';

function readGitHubEvent(): GitHubPullRequestEvent | undefined {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || !fs.existsSync(eventPath)) return undefined;

    try {
        return JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as GitHubPullRequestEvent;
    } catch (error: any) {
        core.warning(`Unable to parse GitHub event payload: ${error.message}`);
        return undefined;
    }
}

function encodeGitHubContentPath(filePath: string): string {
    return filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function isPromptLikeFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const ext = path.extname(lower);
    if (['.md', '.prompt', '.yml', '.yaml', '.json', '.txt', '.ai', '.chat'].includes(ext)) return true;
    if (lower.endsWith('/mcp.json') || lower === 'mcp.json') return true;
    if (lower.endsWith('claude_desktop_config.json')) return true;
    return false;
}

function isRecognizedMcpConfig(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    return normalized.endsWith('/mcp.json')
        || normalized.endsWith('/.vscode/mcp.json')
        || normalized.endsWith('/claude_desktop_config.json')
        || normalized === 'mcp.json'
        || normalized === 'claude_desktop_config.json';
}

async function githubRequestJson(args: { url: string; token: string; method?: string; body?: any }): Promise<any> {
    const response = await fetch(args.url, {
        method: args.method ?? 'GET',
        headers: {
            Authorization: `Bearer ${args.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: args.body ? JSON.stringify(args.body) : undefined,
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`GitHub API ${args.method ?? 'GET'} ${args.url} returned ${response.status}: ${detail}`);
    }

    return response.json();
}

async function listPullRequestFiles(args: { owner: string; repo: string; pullNumber: number; token: string }): Promise<PullFile[]> {
    const files: PullFile[] = [];
    let page = 1;
    while (true) {
        const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/files?per_page=100&page=${page}`;
        const batch = await githubRequestJson({ url, token: args.token }) as PullFile[];
        files.push(...batch);
        if (batch.length < 100) break;
        page += 1;
    }
    return files;
}

async function getFileContentAtRef(args: { owner: string; repo: string; filePath: string; ref: string; token: string }): Promise<string | undefined> {
    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/contents/${encodeGitHubContentPath(args.filePath)}?ref=${encodeURIComponent(args.ref)}`;
    try {
        const json = await githubRequestJson({ url, token: args.token });
        if (!json || typeof json !== 'object') return undefined;
        if (json.type !== 'file') return undefined;
        if (typeof json.content !== 'string' || typeof json.encoding !== 'string') return undefined;
        if (json.encoding !== 'base64') return undefined;
        return Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    } catch {
        return undefined;
    }
}

async function upsertIssueComment(args: { owner: string; repo: string; issueNumber: number; token: string; body: string }): Promise<void> {
    const listUrl = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments?per_page=100`;
    const existing = await githubRequestJson({ url: listUrl, token: args.token }) as Array<{ id: number; body?: string }>;
    const match = existing.find(comment => typeof comment.body === 'string' && comment.body.includes(PR_REVIEW_MARKER));

    if (match) {
        const url = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/comments/${match.id}`;
        await githubRequestJson({ url, token: args.token, method: 'PATCH', body: { body: args.body } });
        return;
    }

    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`;
    await githubRequestJson({ url, token: args.token, method: 'POST', body: { body: args.body } });
}

async function createInlineReviewComments(args: { owner: string; repo: string; pullNumber: number; token: string; commitId: string; comments: Array<{ path: string; line: number; body: string }> }): Promise<void> {
    if (args.comments.length === 0) return;
    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/reviews`;
    const payload = {
        commit_id: args.commitId,
        event: 'COMMENT',
        comments: args.comments.map(comment => ({
            path: comment.path,
            line: comment.line,
            side: 'RIGHT',
            body: comment.body,
        })),
    };
    await githubRequestJson({ url, token: args.token, method: 'POST', body: payload });
}

async function uploadSarifToGitHub(args: { owner: string; repo: string; token: string; sarifPath: string; commitSha: string; ref: string }): Promise<void> {
    const sarif = fs.readFileSync(args.sarifPath, 'utf-8');
    const sarifBase64 = Buffer.from(sarif, 'utf-8').toString('base64');
    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/code-scanning/sarifs`;
    await githubRequestJson({
        url,
        token: args.token,
        method: 'POST',
        body: {
            sarif: sarifBase64,
            commit_sha: args.commitSha,
            ref: args.ref,
            tool_name: 'PromptSonar',
        },
    });
}

function collectExecutionPaths(results: ScanResult[]): string[] {
    const sinks = new Set<string>();
    for (const r of results) {
        for (const f of r.findings) {
            if (f.waived) continue;
            const workflow = f.workflow;
            if (!workflow) continue;
            for (const node of workflow.path.nodes) {
                if (node.type === 'shell_execution') sinks.add('Shell Execution');
                if (node.type === 'network_access') sinks.add('Network Access');
                if (node.type === 'filesystem_access') sinks.add('Filesystem Access');
                if (node.type === 'credential_store') sinks.add('Credential Store');
                if (node.type === 'external_api') sinks.add('External API');
            }
        }
    }
    return Array.from(sinks);
}

function computeConfidenceSummary(results: ScanResult[]): { score: number; level: string } | undefined {
    let bestScore = -1;
    let bestLevel = '';
    for (const r of results) {
        for (const f of r.findings) {
            if (f.waived) continue;
            const wf = f.workflow;
            if (!wf || typeof wf.confidence_score !== 'number' || !wf.confidence_level) continue;
            if (wf.confidence_score > bestScore) {
                bestScore = wf.confidence_score;
                bestLevel = wf.confidence_level;
            }
        }
    }
    if (bestScore < 0) return undefined;
    return { score: Math.round(bestScore), level: bestLevel };
}

function repositorySummaryMarkdown(report: ReturnType<typeof analyzeRepositoryExecution>): string {
    const s = report.summary;
    const reachableActions = Object.entries(s.reachableSensitiveActions)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ') || 'None';

    return [
        '## PromptSonar Repository Execution Analysis',
        '',
        '| Metric | Value |',
        '| --- | ---: |',
        `| AI Surfaces | ${s.aiSurfacesFound.prompts + s.aiSurfacesFound.skills + s.aiSurfacesFound.mcpServers + s.aiSurfacesFound.tools + s.aiSurfacesFound.workflows + s.aiSurfacesFound.memorySystems} |`,
        `| Execution Nodes | ${s.executionGraph.nodes} |`,
        `| Execution Edges | ${s.executionGraph.edges} |`,
        `| Reachable Sensitive Actions | ${report.reachablePaths.length} |`,
        `| Canonical Issues | ${report.issueSummary.total} |`,
        `| High Risk Paths | ${s.riskSummary.high} |`,
        `| Critical Paths | ${s.riskSummary.critical} |`,
        `| Trust Status | ${s.trustStatus} |`,
        '',
        `Reachable sensitive actions: ${reachableActions}`,
        '',
        ...report.issues.slice(0, 10).flatMap(issue => [
            `### ${issue.id}`,
            '',
            `- **Issue:** ${issue.issue}`,
            `- **Impact:** ${issue.impact}`,
            `- **Why this matters:** ${issue.whyThisMatters}`,
            `- **How to fix:** ${issue.howToFix}`,
            `- **Evidence:** ${issue.evidence.map(item => `${item.file}:${item.line || 1}`).join(', ')}`,
            `- **Confidence:** ${issue.confidence.label} (${issue.confidence.score}%)`,
            '',
        ]),
    ].join('\n');
}

function toCoreFindings(results: ScanResult[]): Finding[] {
    const findings: Finding[] = [];
    for (const r of results) {
        for (const f of r.findings) {
            if (f.waived) continue;
            if (f.rule_id.startsWith('MCP-')) continue;
            findings.push({
                rule_id: f.rule_id,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                category: f.category as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                severity: f.severity as any,
                explanation: f.message,
                suggested_fix: f.fix,
                workflow: f.workflow,
            });
        }
    }
    return findings;
}

function computeRootCauseSummary(findings: Finding[]): { name: string; supporting: string[] } | undefined {
    const analysis = analyzeRootCause(findings);
    if (!analysis) return undefined;
    return {
        name: humanRuleName(analysis.rootCause.rule_id),
        supporting: analysis.supportingFindings.map(f => humanRuleName(f.rule_id)),
    };
}

function pickHighestRiskWorkflowGraph(results: ScanResult[]): { summary?: string; graph?: any } {
    let best: { riskScore: number; summary?: string; graph?: any } = { riskScore: -1 };
    for (const r of results) {
        for (const f of r.findings) {
            if (f.waived) continue;
            const wf = f.workflow;
            if (!wf) continue;
            const graph = pathToGraph(wf.path);
            if (graph.riskScore > best.riskScore) {
                best = { riskScore: graph.riskScore, summary: workflowPathSummary(wf), graph };
            }
        }
    }
    return { summary: best.summary, graph: best.graph };
}

function computeWorkflowDiffForFile(args: { before: ScanResult[]; after: ScanResult[] }): { diff?: WorkflowDiff; beforeSummary?: string; afterSummary?: string; introduced: boolean; removed: boolean; riskReduction?: number } {
    const beforePick = pickHighestRiskWorkflowGraph(args.before);
    const afterPick = pickHighestRiskWorkflowGraph(args.after);
    const beforeGraph = beforePick.graph;
    const afterGraph = afterPick.graph;

    if (!beforeGraph && !afterGraph) return { introduced: false, removed: false };
    if (!beforeGraph && afterGraph) return { introduced: afterGraph.privilegedSinkReached, removed: false, afterSummary: afterPick.summary };
    if (beforeGraph && !afterGraph) return { introduced: false, removed: beforeGraph.privilegedSinkReached, beforeSummary: beforePick.summary };

    const diff = computeWorkflowDiff(beforeGraph, afterGraph);
    const introduced = !beforeGraph.privilegedSinkReached && afterGraph.privilegedSinkReached;
    return { diff, introduced, removed: diff.executionPathRemoved, beforeSummary: beforePick.summary, afterSummary: afterPick.summary, riskReduction: diff.riskReduction };
}

async function run(): Promise<void> {
    try {
        const failOn = core.getInput('fail-on') || 'critical';
        const waiverFile = core.getInput('waiver-file') || '.promptsonar-waivers.yaml';
        const uploadSarif = core.getInput('upload-sarif') === 'true';
        const diffOnlyInput = core.getInput('diff-only') === 'true';

        const workspace = process.env.GITHUB_WORKSPACE || '.';
        const waiverPath = fs.existsSync(path.join(workspace, waiverFile))
            ? path.join(workspace, waiverFile)
            : (fs.existsSync(waiverFile) ? path.resolve(waiverFile) : undefined);

        const configPathCandidates = [
            path.join(workspace, '.promptsonar.yml'),
            path.join(workspace, '.promptsonar.yaml'),
        ];
        const configPath = configPathCandidates.find(candidate => fs.existsSync(candidate));
        const config: PromptSonarPrReviewConfig = configPath
            ? parsePromptSonarPrReviewConfig(fs.readFileSync(configPath, 'utf-8'))
            : (failOn === 'none'
                ? { fail_on: [] }
                : parsePromptSonarPrReviewConfig(`fail_on:\n  - ${failOn}\n`));

        const event = readGitHubEvent();
        const pullRequest = event?.pull_request;
        const repoFull = event?.repository?.full_name || process.env.GITHUB_REPOSITORY || '';
        const [owner, repo] = repoFull.split('/');
        const token = process.env.GITHUB_TOKEN;

        const isPrContext = Boolean(pullRequest && owner && repo && token);
        const diffOnly = isPrContext ? true : diffOnlyInput;

        let changedFiles: PullFile[] = [];
        if (isPrContext && pullRequest) {
            changedFiles = await listPullRequestFiles({ owner, repo, pullNumber: pullRequest.number, token: token! });
        }

        const scannableFiles = diffOnly && isPrContext
            ? changedFiles.filter(file => file.status !== 'removed' && isPromptLikeFile(file.filename))
            : [];

        const results: ScanResult[] = [];
        let maxMcpRiskScore: number | undefined = undefined;
        let mcpSummary: { score: number; severity: string; capabilities: string[]; approvalMode?: string } | undefined = undefined;
        if (diffOnly && isPrContext) {
            for (const file of scannableFiles) {
                const abs = path.join(workspace, file.filename);
                if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
                const content = fs.readFileSync(abs, 'utf-8');
                if (isRecognizedMcpConfig(file.filename)) {
                    const mcp = auditMcpConfig(file.filename, content);
                    if (typeof mcp.risk_score === 'number') {
                        maxMcpRiskScore = maxMcpRiskScore === undefined ? mcp.risk_score : Math.max(maxMcpRiskScore, mcp.risk_score);
                        const caps = Array.from(new Set((mcp.servers || []).flatMap(server => server.capabilities || [])));
                        const approvalMode = (mcp.servers || []).some(server => server.execution_mode === 'auto')
                            ? 'Automatic'
                            : (mcp.servers || []).some(server => server.execution_mode === 'manual')
                                ? 'Manual'
                                : 'Unknown';
                        const severity = mcp.risk_score >= 85 ? 'CRITICAL' : mcp.risk_score >= 60 ? 'HIGH' : mcp.risk_score >= 30 ? 'MEDIUM' : 'LOW';
                        if (!mcpSummary || mcp.risk_score > mcpSummary.score) {
                            mcpSummary = { score: mcp.risk_score, severity, capabilities: caps, approvalMode };
                        }
                    }
                }
                const res = await scanFileContent(file.filename, content, { verbose: false, waiverFile: waiverPath });
                results.push(...res);
            }
        } else {
            results.push(...await scanFiles(workspace, { verbose: false, diffOnly: false, waiverFile: waiverPath }));
        }

        let worstScore = 100;
        for (const r of results) worstScore = Math.min(worstScore, r.overall_score);
        const repositoryReport = analyzeRepositoryExecution(workspace, results as any);
        const counts = {
            critical: repositoryReport.issueSummary.critical,
            high: repositoryReport.issueSummary.high,
            medium: repositoryReport.issueSummary.medium,
        };

        core.setOutput('score', worstScore.toString());
        core.setOutput('criticals', counts.critical.toString());
        core.setOutput('highs', counts.high.toString());
        core.setOutput('critical_count', counts.critical.toString());
        core.setOutput('high_count', counts.high.toString());
        core.setOutput('medium_count', counts.medium.toString());
        core.setOutput('files_scanned', (diffOnly && isPrContext ? scannableFiles.length : results.length).toString());
        core.setOutput('execution_paths', JSON.stringify(collectExecutionPaths(results)));
        core.setOutput('mcp_risk_score', maxMcpRiskScore === undefined ? '' : String(maxMcpRiskScore));

        const confidenceOut = computeConfidenceSummary(results);
        core.setOutput('confidence_score', confidenceOut ? String(confidenceOut.score) : '');
        core.setOutput('confidence_level', confidenceOut ? confidenceOut.level : '');
        core.setOutput('issue_count', String(repositoryReport.issueSummary.total));
        core.setOutput('issue_ids', JSON.stringify(repositoryReport.issues.map(issue => issue.id)));

        const sarifPath = path.join(workspace, 'promptsonar-results.sarif');
        fs.writeFileSync(sarifPath, formatRepositoryReportSarif(repositoryReport), 'utf-8');
        core.setOutput('sarif-path', sarifPath);

        const repositoryReportPath = path.join(workspace, 'repository-report.json');
        const executionMapPath = path.join(workspace, 'execution-map.json');
        const repositoryHtmlPath = path.join(workspace, 'repository-report.html');
        const repositorySarifPath = path.join(workspace, 'repository-report.sarif');
        fs.writeFileSync(repositoryReportPath, formatRepositoryReportJson(repositoryReport), 'utf-8');
        fs.writeFileSync(executionMapPath, JSON.stringify(repositoryReport.executionMap, null, 2), 'utf-8');
        fs.writeFileSync(repositoryHtmlPath, formatRepositoryReportHtml(repositoryReport), 'utf-8');
        fs.writeFileSync(repositorySarifPath, formatRepositoryReportSarif(repositoryReport), 'utf-8');
        core.setOutput('repository-report-path', repositoryReportPath);
        core.setOutput('execution-map-path', executionMapPath);
        core.setOutput('repository-html-report-path', repositoryHtmlPath);
        core.setOutput('repository-sarif-path', repositorySarifPath);
        core.setOutput('trust_status', repositoryReport.summary.trustStatus);
        core.setOutput('reachable_sensitive_actions', String(repositoryReport.reachablePaths.length));
        core.setOutput('high_risk_paths', String(repositoryReport.summary.riskSummary.high));

        if (core.summary) {
            await core.summary.addRaw(repositorySummaryMarkdown(repositoryReport)).write();
        }

        try {
            const { DefaultArtifactClient } = await import('@actions/artifact');
            const artifactClient = new DefaultArtifactClient();
            await artifactClient.uploadArtifact('promptsonar-repository-execution-analysis', [
                repositoryReportPath,
                executionMapPath,
                repositoryHtmlPath,
                repositorySarifPath,
            ], workspace);
            core.info('Repository execution analysis artifacts uploaded.');
        } catch (error: any) {
            core.warning(`Unable to upload repository execution artifacts: ${error.message}`);
        }

        if (uploadSarif && isPrContext && token) {
            const commitSha = pullRequest?.head?.sha || process.env.GITHUB_SHA || '';
            const branch = pullRequest?.head?.ref || process.env.GITHUB_REF_NAME || '';
            const ref = branch ? `refs/heads/${branch}` : '';
            if (commitSha && ref) {
                await uploadSarifToGitHub({ owner, repo, token, sarifPath, commitSha, ref });
                core.info('SARIF uploaded to GitHub code scanning.');
            }
        }

        const workflowDiffSummaries: Array<{ filePath: string; diff?: WorkflowDiff; executionPathIntroduced: boolean }> = [];
        const workflowDiffEntries: Array<{ filePath: string; before?: string; after?: string; introduced?: boolean; removed?: boolean; riskReduction?: number }> = [];
        const inlineComments: Array<{ path: string; line: number; body: string }> = [];

        if (isPrContext && pullRequest && token && diffOnly) {
            const baseSha = pullRequest.base?.sha;
            const headSha = pullRequest.head?.sha || process.env.GITHUB_SHA || '';

            for (const file of scannableFiles) {
                if (!baseSha) continue;
                const afterAbs = path.join(workspace, file.filename);
                if (!fs.existsSync(afterAbs)) continue;

                const afterContent = fs.readFileSync(afterAbs, 'utf-8');
                const beforePath = file.previous_filename || file.filename;
                const beforeContent = await getFileContentAtRef({ owner, repo, filePath: beforePath, ref: baseSha, token });
                if (!beforeContent) continue;

                const beforeResults = await scanFileContent(beforePath, beforeContent, { verbose: false, waiverFile: waiverPath });
                const afterResults = await scanFileContent(file.filename, afterContent, { verbose: false, waiverFile: waiverPath });
                const diff = computeWorkflowDiffForFile({ before: beforeResults, after: afterResults });

                workflowDiffSummaries.push({ filePath: file.filename, diff: diff.diff, executionPathIntroduced: diff.introduced });
                workflowDiffEntries.push({
                    filePath: file.filename,
                    before: diff.beforeSummary,
                    after: diff.afterSummary,
                    introduced: diff.introduced,
                    removed: diff.removed,
                    riskReduction: diff.riskReduction,
                });

                const patchLines = file.patch ? extractChangedLinesFromGitHubPatch(file.patch) : new Set<number>();
                for (const issue of repositoryReport.issues) {
                    if (!(issue.severity === 'critical' || issue.severity === 'high')) continue;
                    if (!issue.impactedFiles.includes(file.filename.replace(/\\/g, '/'))) continue;
                    const evidence = issue.evidence[0];
                    const line = evidence?.line || 1;
                    if (!patchLines.has(line)) continue;
                    inlineComments.push({
                        path: file.filename,
                        line,
                        body: `**${issue.id}** (${issue.severity})\n\n**Issue:** ${issue.issue}\n\n**Impact:** ${issue.impact}\n\n**Why this matters:** ${issue.whyThisMatters}\n\n**Evidence:** \`${evidence?.snippet || issue.issue}\`\n\n**How to fix:** ${issue.howToFix}`,
                    });
                }
            }

            const coreFindings = toCoreFindings(results);
            const analysis = analyzeRootCause(coreFindings);
            const rootCause = analysis
                ? {
                    name: humanRuleName(analysis.rootCause.rule_id),
                    supporting: analysis.supportingFindings.map(f => humanRuleName(f.rule_id)),
                }
                : undefined;
            const provenanceEvidence = analysis?.rootCause.workflow?.workflow_evidence
                || analysis?.rootCause.workflow?.evidence?.map(e => e.label)
                || [];

            const confidence = computeConfidenceSummary(results);
            const execPaths = collectExecutionPaths(results);

            const body = buildPrReviewSummaryMarkdown({
                filesScanned: scannableFiles.length,
                counts,
                executionPaths: execPaths,
                confidence,
                rootCause,
                provenanceEvidence: provenanceEvidence.slice(0, 6),
                mcpRisk: mcpSummary,
                workflowDiffs: workflowDiffEntries,
            });

            await upsertIssueComment({
                owner,
                repo,
                issueNumber: pullRequest.number,
                token,
                body: `${PR_REVIEW_MARKER}\n${body}`,
            });

            await createInlineReviewComments({
                owner,
                repo,
                pullNumber: pullRequest.number,
                token,
                commitId: headSha,
                comments: inlineComments.slice(0, 20),
            });

            core.setOutput('workflow_diff', JSON.stringify(workflowDiffEntries));
        }

        const decision = evaluatePrReviewGates(config, {
            counts,
            workflowDiffs: workflowDiffSummaries,
            mcpRiskScore: maxMcpRiskScore,
        });

        if (decision.shouldFail) {
            core.setFailed(decision.reason || `PromptSonar: policy gate failed. Score: ${worstScore}/100`);
        }
    } catch (error: any) {
        core.setFailed(`PromptSonar Action failed: ${error.message}`);
    }
}

run();
