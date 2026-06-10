import * as path from 'path';

type RepositoryReportLike = {
    repository?: { root?: string };
    impactedFiles?: any[];
    issues?: any[];
    reachablePaths?: any[];
};

export type RepositoryFileInvestigation = {
    path: string;
    absolutePath: string;
    name: string;
    type: string;
    issueCount: number;
    highestSeverity: string;
    issues: any[];
    impacts: string[];
    evidence: any[];
    fixes: Array<{ label: string; value: string }>;
    executionPaths: any[];
};

export function editorLineForEvidence(line: unknown): number {
    const parsed = Number(line);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed) - 1) : 0;
}

function normalize(value: string): string {
    return value.replace(/\\/g, '/');
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const value = key(item);
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function absoluteFile(root: string, file: string): string {
    return path.isAbsolute(file) ? file : path.join(root, file);
}

export function buildRepositoryFileInvestigations(report: RepositoryReportLike): RepositoryFileInvestigation[] {
    const root = String(report.repository?.root || '');
    const issuesById = new Map((report.issues || []).map(issue => [issue.id, issue]));
    const pathsById = new Map((report.reachablePaths || []).map(pathItem => [pathItem.id, pathItem]));

    return (report.impactedFiles || []).map(file => {
        const issues = (file.issueIds || []).map((id: string) => issuesById.get(id)).filter(Boolean);
        const evidence = uniqueBy(
            issues.flatMap((issue: any) => issue.evidence || []),
            (item: any) => item.id || `${item.file}:${item.line || 0}:${item.snippet || ''}`,
        ).map((item: any) => ({
            ...item,
            absolutePath: absoluteFile(root, item.file || file.path),
        }));
        const fixes = uniqueBy(
            issues.flatMap((issue: any) => [
                { label: 'Quick Fix', value: issue.fix?.quickFix || issue.howToFix },
                { label: 'Recommended Fix', value: issue.fix?.recommendedFix || issue.howToFix },
                { label: 'Safe Pattern', value: issue.fix?.safePattern },
                { label: 'Effort', value: issue.fix?.effort },
            ]).filter((fix: any) => fix.value),
            fix => `${fix.label}:${fix.value}`,
        );
        const pathIds = Array.from(new Set([
            ...(file.pathIds || []),
            ...issues.flatMap((issue: any) => issue.pathIds || []),
        ]));

        return {
            path: normalize(file.path),
            absolutePath: absoluteFile(root, file.path),
            name: file.name || path.basename(file.path),
            type: file.type || 'Other',
            issueCount: file.issueCount ?? issues.length,
            highestSeverity: file.highestSeverity || issues[0]?.severity || 'low',
            issues,
            impacts: Array.from(new Set(issues.map((issue: any) => issue.impact).filter(Boolean))) as string[],
            evidence,
            fixes,
            executionPaths: pathIds.map(id => pathsById.get(id)).filter(Boolean),
        };
    });
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function renderRepositoryFileInvestigations(files: RepositoryFileInvestigation[]): string {
    return `<section id="impacted-files">
      <h2>Impacted Files (${files.length})</h2>
      <p class="file-priority">These are the files you should fix.</p>
      <div class="file-grid">
        ${files.map(file => `<button class="file-card" data-investigate-file="${escapeHtml(file.path)}">
          <span class="badge">${escapeHtml(file.type)}</span>
          <strong>${escapeHtml(file.path)}</strong>
          <span class="muted">${file.issueCount} issue${file.issueCount === 1 ? '' : 's'} · ${file.executionPaths.length} execution path${file.executionPaths.length === 1 ? '' : 's'}</span>
          <span class="risk-${escapeHtml(file.highestSeverity)}">${escapeHtml(file.highestSeverity)}</span>
        </button>`).join('') || '<div class="muted">No files are impacted by active issues.</div>'}
      </div>
      <div id="file-investigation-empty" class="investigation-empty">Select an impacted file to investigate its issues, evidence, fixes, and execution paths.</div>
      ${files.map(file => `<article class="file-investigation" data-file-panel="${escapeHtml(file.path)}" hidden>
        <div class="file-heading">
          <div><span class="badge">${escapeHtml(file.type)}</span><h3>${escapeHtml(file.path)}</h3></div>
          <button class="source-button" data-open-file="${escapeHtml(file.absolutePath)}">Open Source</button>
        </div>
        <h4>Issues</h4>
        ${file.issues.map(issue => `<div class="investigation-item"><strong class="risk-${escapeHtml(issue.severity)}">${escapeHtml(issue.severity)} · ${escapeHtml(issue.id)}</strong><div>${escapeHtml(issue.issue)}</div></div>`).join('') || '<div class="muted">No active issues.</div>'}
        <h4>Impact</h4>
        ${file.impacts.map(impact => `<div class="investigation-item">${escapeHtml(impact)}</div>`).join('') || '<div class="muted">No impact recorded.</div>'}
        <h4>Evidence</h4>
        ${file.evidence.map(evidence => `<button class="evidence-item" data-open-file="${escapeHtml(evidence.absolutePath)}" data-line="${escapeHtml(evidence.line || 1)}"><code>${escapeHtml(evidence.file)}:${escapeHtml(evidence.line || 1)}</code><span>${escapeHtml(evidence.snippet)}</span></button>`).join('') || '<div class="muted">No evidence recorded.</div>'}
        <h4>Fixes</h4>
        ${file.fixes.map(fix => `<div class="investigation-item"><strong>${escapeHtml(fix.label)}</strong><div class="${fix.label === 'Safe Pattern' ? 'safe-pattern' : ''}">${escapeHtml(fix.value)}</div></div>`).join('') || '<div class="muted">No fixes recorded.</div>'}
        <h4>Execution Paths</h4>
        ${file.executionPaths.map(pathItem => `<div class="investigation-item"><strong class="risk-${escapeHtml(pathItem.risk)}">${escapeHtml(pathItem.risk)} · ${escapeHtml((pathItem.sensitiveActions || []).join(', '))}</strong><div>${escapeHtml(pathItem.explanation)}</div></div>`).join('') || '<div class="muted">No graph-backed execution path is connected to this file.</div>'}
      </article>`).join('')}
    </section>`;
}
