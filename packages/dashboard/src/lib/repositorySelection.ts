const TEXT_FILE_PATTERN = /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const IGNORED_PARTS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);

export const MAX_BROWSER_FILES = 200;
export const MAX_BROWSER_FILE_CHARS = 20_000;
export const MAX_BROWSER_TOTAL_CHARS = 1_000_000;

export function repositoryFileDisplayName(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function normalizeRepositoryPath(value: string): string {
  return value.replace(/\\/g, "/").split("/").filter(part => part && part !== "." && part !== "..").join("/");
}

export function stripCommonRepositoryRoot(paths: string[]): Map<string, string> {
  const normalized = paths.map(normalizeRepositoryPath);
  const firstParts = normalized
    .filter(path => path.includes("/"))
    .map(path => path.split("/")[0]);
  const commonRoot = firstParts.length === normalized.length && new Set(firstParts).size === 1
    ? firstParts[0]
    : "";

  return new Map(paths.map((original, index) => {
    const path = normalized[index];
    return [
      original,
      commonRoot && path.startsWith(`${commonRoot}/`) ? path.slice(commonRoot.length + 1) : path,
    ];
  }));
}

export function shouldReadRepositoryPath(path: string, mimeType = ""): boolean {
  const name = normalizeRepositoryPath(path);
  if (name.split("/").some((part) => IGNORED_PARTS.has(part))) return false;
  return TEXT_FILE_PATTERN.test(name) || mimeType.startsWith("text/");
}

export function repositoryPathPriority(path: string): number {
  const name = `/${normalizeRepositoryPath(path)}`.toLowerCase();
  if (name.includes("/.cursor/") || name.includes("/.claude/") || name.endsWith("/mcp.json")) return 100;
  if (name.endsWith("skill.md") || name.includes("/skills/")) return 90;
  if (name.endsWith(".prompt") || name.includes("/prompts/")) return 80;
  if (name.includes("/.github/workflows/") || name.includes("/workflows/")) return 70;
  if (name.includes("agent") || name.includes("memory") || name.includes("tool-router")) return 60;
  if (/\.(json|ya?ml|toml|config|rules)$/i.test(name)) return 50;
  return 10;
}

function boundedFileSize(file: File): number {
  const size = Number.isFinite(file.size) && file.size > 0 ? file.size : MAX_BROWSER_FILE_CHARS;
  return Math.min(size, MAX_BROWSER_FILE_CHARS);
}

export function prepareRepositorySelection(allFiles: File[]) {
  const displayPaths = allFiles.map(repositoryFileDisplayName);
  const repoPathByDisplayPath = stripCommonRepositoryRoot(displayPaths);
  const eligibleItems = allFiles
    .map(file => {
      const displayPath = repositoryFileDisplayName(file);
      return {
        file,
        repoPath: repoPathByDisplayPath.get(displayPath) || normalizeRepositoryPath(displayPath),
      };
    })
    .filter(item => shouldReadRepositoryPath(item.repoPath, item.file.type))
    .sort((a, b) =>
      repositoryPathPriority(b.repoPath) - repositoryPathPriority(a.repoPath) ||
      a.repoPath.localeCompare(b.repoPath),
    );
  const fileCandidates = eligibleItems.slice(0, MAX_BROWSER_FILES);
  const queuedFiles: File[] = [];
  let estimatedChars = 0;

  for (const { file } of fileCandidates) {
    if (estimatedChars >= MAX_BROWSER_TOTAL_CHARS) break;
    queuedFiles.push(file);
    estimatedChars += Math.min(boundedFileSize(file), MAX_BROWSER_TOTAL_CHARS - estimatedChars);
  }

  return {
    files: queuedFiles,
    stats: {
      total: allFiles.length,
      eligible: eligibleItems.length,
      queued: queuedFiles.length,
      excludedByFileLimit: Math.max(0, eligibleItems.length - fileCandidates.length),
      excludedByPayloadLimit: Math.max(0, fileCandidates.length - queuedFiles.length),
      estimatedChars,
    },
  };
}

export async function buildRepositoryPayload(
  files: File[],
  onProgress?: (completed: number, total: number) => void,
) {
  const payload: Array<{ path: string; content: string }> = [];
  let totalChars = 0;
  const displayPaths = files.map(repositoryFileDisplayName);
  const repoPathByDisplayPath = stripCommonRepositoryRoot(displayPaths);

  for (let index = 0; index < files.length; index += 1) {
    const remaining = MAX_BROWSER_TOTAL_CHARS - totalChars;
    if (remaining <= 0) break;
    const file = files[index];
    const readLimit = Math.min(MAX_BROWSER_FILE_CHARS, remaining);
    const content = (await file.slice(0, readLimit).text()).slice(0, readLimit);
    const displayPath = repositoryFileDisplayName(file);
    payload.push({
      path: repoPathByDisplayPath.get(displayPath) || normalizeRepositoryPath(displayPath),
      content,
    });
    totalChars += content.length;
    onProgress?.(index + 1, files.length);
  }

  return {
    files: payload,
    totalChars,
  };
}
