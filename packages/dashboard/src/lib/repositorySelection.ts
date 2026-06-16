const TEXT_FILE_PATTERN = /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const IGNORED_PARTS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);

export const MAX_BROWSER_FILES = 200;
export const MAX_BROWSER_FILE_CHARS = 20_000;
export const MAX_BROWSER_TOTAL_CHARS = 1_000_000;

export function repositoryFileDisplayName(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function shouldRead(file: File): boolean {
  const name = repositoryFileDisplayName(file).replace(/\\/g, "/");
  if (name.split("/").some((part) => IGNORED_PARTS.has(part))) return false;
  return TEXT_FILE_PATTERN.test(name) || file.type.startsWith("text/");
}

function repositoryFilePriority(file: File): number {
  const name = repositoryFileDisplayName(file).replace(/\\/g, "/").toLowerCase();
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
  const eligibleFiles = allFiles
    .filter(shouldRead)
    .sort((a, b) =>
      repositoryFilePriority(b) - repositoryFilePriority(a) ||
      repositoryFileDisplayName(a).localeCompare(repositoryFileDisplayName(b)),
    );
  const fileCandidates = eligibleFiles.slice(0, MAX_BROWSER_FILES);
  const queuedFiles: File[] = [];
  let estimatedChars = 0;

  for (const file of fileCandidates) {
    if (estimatedChars >= MAX_BROWSER_TOTAL_CHARS) break;
    queuedFiles.push(file);
    estimatedChars += Math.min(boundedFileSize(file), MAX_BROWSER_TOTAL_CHARS - estimatedChars);
  }

  return {
    files: queuedFiles,
    stats: {
      total: allFiles.length,
      eligible: eligibleFiles.length,
      queued: queuedFiles.length,
      excludedByFileLimit: Math.max(0, eligibleFiles.length - fileCandidates.length),
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

  for (let index = 0; index < files.length; index += 1) {
    const remaining = MAX_BROWSER_TOTAL_CHARS - totalChars;
    if (remaining <= 0) break;
    const file = files[index];
    const readLimit = Math.min(MAX_BROWSER_FILE_CHARS, remaining);
    const content = (await file.slice(0, readLimit).text()).slice(0, readLimit);
    payload.push({
      path: repositoryFileDisplayName(file),
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
