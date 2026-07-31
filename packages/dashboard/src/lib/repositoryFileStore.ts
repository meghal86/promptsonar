// Persists the text of uploaded repository files (browser session only) so the
// file microscope can show full-file before/after context. Stored separately
// from the report and keyed by report id. Best-effort: on a storage-quota error
// it sheds older file maps and retries; if it still fails the microscope simply
// falls back to the snippet-level view. Nothing here is sent anywhere.

const PREFIX = "promptsonar:repository-files:";

export function saveRepositoryFiles(
  reportId: string | undefined,
  files: { path: string; content: string }[],
): void {
  if (typeof window === "undefined") return;
  const map: Record<string, string> = {};
  for (const file of files) map[file.path] = file.content;
  const json = JSON.stringify(map);
  const id = reportId || "latest";
  try {
    window.sessionStorage.setItem(`${PREFIX}${id}`, json);
    window.sessionStorage.setItem(`${PREFIX}latest`, json);
  } catch {
    try {
      // Drop file maps from earlier scans, then retry this one only.
      Object.keys(window.sessionStorage)
        .filter((key) => key.startsWith(PREFIX) && key !== `${PREFIX}${id}` && key !== `${PREFIX}latest`)
        .forEach((key) => window.sessionStorage.removeItem(key));
      window.sessionStorage.setItem(`${PREFIX}${id}`, json);
      window.sessionStorage.setItem(`${PREFIX}latest`, json);
    } catch {
      // Give up silently — full-file view degrades to the snippet view.
    }
  }
}

export function readRepositoryFiles(reportId?: string): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  const keys = reportId ? [`${PREFIX}${reportId}`, `${PREFIX}latest`] : [`${PREFIX}latest`];
  for (const key of keys) {
    try {
      const value = window.sessionStorage.getItem(key);
      if (value) return JSON.parse(value) as Record<string, string>;
    } catch {
      return null;
    }
  }
  return null;
}

// Resolve a file's content by repo-relative path, tolerant of a differing
// leading folder between the upload path and the report's relative path.
export function lookupFileContent(map: Record<string, string> | null, path: string): string | null {
  if (!map || !path) return null;
  if (map[path] != null) return map[path];
  const match = Object.keys(map).find(
    (key) => key === path || key.endsWith(`/${path}`) || path.endsWith(`/${key}`),
  );
  return match != null ? map[match] : null;
}
