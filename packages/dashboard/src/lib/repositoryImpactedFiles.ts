export const REPOSITORY_IMPACTED_FILE_TYPES = ['SKILL.md', 'MCP Config', 'Workflow', 'Prompt'] as const;

type RepositoryReportLike = {
  repository?: { root?: string };
  impactedFiles?: any[];
  issues?: any[];
  reachablePaths?: any[];
};

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function buildImpactedFileViews(report: RepositoryReportLike | null | undefined): any[] {
  if (!Array.isArray(report?.impactedFiles)) return [];

  const issuesById = new Map<string, any>((report.issues || []).map(issue => [issue.id, issue]));
  const pathsById = new Map<string, any>((report.reachablePaths || []).map(path => [path.id, path]));

  return report.impactedFiles.map(file => {
    const issues: any[] = (file.issueIds || []).map((id: string) => issuesById.get(id)).filter(Boolean);
    const evidence = uniqueBy<any>(
      issues.flatMap((issue: any) => issue.evidence || []),
      (item: any) => item.id || `${item.file}:${item.line || 0}:${item.snippet || ''}`,
    );
    const fixes = Array.from(new Set(issues.flatMap((issue: any) =>
      [
        issue.fix?.quickFix,
        issue.fix?.recommendedFix,
        issue.fix?.safePattern,
        issue.howToFix,
        ...(issue.fixSuggestions || []),
      ].filter(Boolean)
    )));
    const root = String(report.repository?.root || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const pathsForFile = (report.reachablePaths || []).filter(pathItem =>
      (pathItem.files || []).some((pathFile: string) => {
        const normalized = pathFile.replace(/\\/g, '/');
        const relative = root && normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.replace(/^\/+/, '');
        return relative === file.path;
      })
    );
    const pathIds = Array.from(new Set([
      ...(file.pathIds || []),
      ...issues.flatMap((issue: any) => issue.pathIds || []),
      ...pathsForFile.map(pathItem => pathItem.id),
    ]));

    return {
      ...file,
      issues,
      impacts: Array.from(new Set(issues.map((issue: any) => issue.impact).filter(Boolean))),
      evidence,
      fixes,
      executionPaths: pathIds.map((id: string) => pathsById.get(id)).filter(Boolean),
    };
  });
}
