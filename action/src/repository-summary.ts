import type { RepositoryExecutionReport } from '@promptsonar/core';

export const REPOSITORY_ARTIFACT_FILES = [
    'repository-report.json',
    'execution-map.json',
    'repository-report.html',
    'repository-report.sarif',
] as const;

function markdownCell(value: unknown): string {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function repositorySummaryMarkdown(report: RepositoryExecutionReport): string {
    const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const NON_PRODUCTION = new Set(['documentation', 'test', 'fixture', 'example', 'generated']);
    const isProduction = (issue: RepositoryExecutionReport['issues'][number]) => !NON_PRODUCTION.has(issue.provenance ?? 'production');
    // Production issues lead the table so the list is not dominated by
    // non-production (docs/test/fixture) findings that do not drive trust.
    const topIssues = [...report.issues]
        .sort((left, right) =>
            (isProduction(right) ? 1 : 0) - (isProduction(left) ? 1 : 0) ||
            (severityRank[String(right.severity)] || 0) - (severityRank[String(left.severity)] || 0) ||
            left.id.localeCompare(right.id)
        )
        .slice(0, 5);
    const topPaths = report.reachablePaths.slice(0, 5);

    const validation = report.pathValidation;
    const scanStats = report.summary.scanStats;

    return [
        '# PromptSonar Repository Analysis',
        '',
        '## Trust Status',
        '',
        `**${report.summary.trustStatus}** · ${(report.summary.productionIssueSummary ?? report.issueSummary).total} production issues · ${report.reachablePaths.length} reachable paths`,
        ...(report.summary.productionIssueSummary && report.summary.nonProductionIssueSummary
            ? ['',
                `Production: ${report.summary.productionIssueSummary.critical} critical · ${report.summary.productionIssueSummary.high} high · ${report.summary.productionIssueSummary.medium} medium · ${report.summary.productionIssueSummary.low} low. Non-production (docs/tests/fixtures): ${report.summary.nonProductionIssueSummary.critical} critical · ${report.summary.nonProductionIssueSummary.high} high · ${report.summary.nonProductionIssueSummary.medium} medium · ${report.summary.nonProductionIssueSummary.low} low — not counted toward trust.`]
            : []),
        '',
        validation && !validation.valid
            ? `> ⚠️ **Path validation failed** — ${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'} across ${validation.checkedPaths} checked paths. Treat path-derived results with caution (details in \`repository-report.json\`).`
            : `Path validation: passed (${validation ? validation.checkedPaths : 0} paths checked).`,
        ...(scanStats
            ? [`Files: ${scanStats.filesConsidered} considered · ${scanStats.filesScanned} scanned · ${scanStats.filesSkipped} skipped${scanStats.truncated ? ' · **⚠️ scan truncated at file limit**' : ''}`]
            : []),
        '',
        '## Top Issues',
        '',
        '| Severity | Context | Issue | Impacted Files | Quick Fix |',
        '| --- | --- | --- | --- | --- |',
        ...(topIssues.length > 0
            ? topIssues.map(issue => `| ${markdownCell(String(issue.severity).toUpperCase())} | ${markdownCell(issue.provenance ?? 'production')} | ${markdownCell(issue.issue)} | ${markdownCell(issue.impactedFiles.join(', '))} | ${markdownCell(issue.fix.quickFix)} |`)
            : ['| None | - | No active issues | - | - |']),
        '',
        `## Impacted Files (${report.impactedFiles.length})`,
        '',
        ...(report.impactedFiles.length > 0
            ? report.impactedFiles.slice(0, 15).map(file => `- **${markdownCell(file.path)}** · ${file.issueCount} issue${file.issueCount === 1 ? '' : 's'} · highest severity: ${markdownCell(file.highestSeverity)}`)
            : ['No files are impacted by active issues.']),
        ...(report.impactedFiles.length > 15 ? [`- ${report.impactedFiles.length - 15} additional impacted files are available in the generated report.`] : []),
        '',
        `## Reachable Paths (${report.reachablePaths.length})`,
        '',
        ...(topPaths.length > 0
            ? topPaths.map(pathItem => `- **${markdownCell(pathItem.risk.toUpperCase())} · ${markdownCell(pathItem.sensitiveActions.join(', '))}**: ${markdownCell(pathItem.explanation)}`)
            : ['No graph-backed sensitive-action paths were found.']),
        ...(report.reachablePaths.length > 5 ? [`- ${report.reachablePaths.length - 5} additional paths are available in the generated report.`] : []),
        '',
        '## Artifacts Generated',
        '',
        ...REPOSITORY_ARTIFACT_FILES.map(file => `- \`${file}\``),
        '',
        'Artifact bundle: `promptsonar-repository-execution-analysis`',
    ].join('\n');
}
