// Client-side GitHub repository fetch. A GitHub scan is the folder-upload flow
// with a different source: the browser reads the repo through GitHub's API +
// raw CDN, applies the SAME prioritization as a local folder, and the bounded
// selection is then posted to the existing /api/repository scan. No server-side
// clone, so it fits the serverless budget. Public repos work unauthenticated.

import {
  MAX_BROWSER_FILES,
  MAX_BROWSER_FILE_CHARS,
  MAX_BROWSER_TOTAL_CHARS,
  repositoryPathPriority,
  shouldReadRepositoryPath,
} from "./repositorySelection";

export type GithubTarget = { owner: string; repo: string; branch?: string };

// Accepts github.com/org/repo, the full https URL, an org/repo shorthand, and
// /tree/<branch> URLs.
export function parseGithubUrl(input: string): GithubTarget | null {
  const value = input.trim();
  if (!value) return null;
  let owner = "";
  let repo = "";
  let branch: string | undefined;

  const urlMatch = value.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+))?(?:[/?#].*)?$/i);
  if (urlMatch) {
    owner = urlMatch[1];
    repo = urlMatch[2];
    branch = urlMatch[3];
  } else {
    const shorthand = value.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (shorthand) {
      owner = shorthand[1];
      repo = shorthand[2];
    }
  }
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/i, ""), branch };
}

type TreeEntry = { path: string; type: string; size?: number };

function ghHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson(url: string, token?: string): Promise<any> {
  const response = await fetch(url, { headers: ghHeaders(token) });
  if (response.status === 404) throw new Error("Repository not found. Check the URL, or it may be private (private repos need a token).");
  if (response.status === 403) throw new Error("GitHub rate limit reached for this network. Try again later, or add a token for higher limits.");
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return response.json();
}

export type GithubFetchResult = {
  files: Array<{ path: string; content: string }>;
  repositoryName: string;
  branch: string;
  stats: {
    totalInTree: number;
    eligible: number;
    queued: number;
    estimatedChars: number;
    excludedByFileLimit: number;
    excludedByPayloadLimit: number;
  };
};

// Resolve the branch, list the tree, prioritize, and download the chosen files
// from the raw CDN (which doesn't consume the API rate limit).
export async function fetchGithubRepoFiles(
  target: GithubTarget,
  onProgress?: (message: string) => void,
  token?: string,
): Promise<GithubFetchResult> {
  const { owner, repo } = target;
  let branch = target.branch;

  if (!branch) {
    onProgress?.(`Resolving ${owner}/${repo}…`);
    const meta = await githubJson(`https://api.github.com/repos/${owner}/${repo}`, token);
    branch = meta?.default_branch || "main";
  }

  onProgress?.(`Listing files on ${branch}…`);
  const tree = await githubJson(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch!)}?recursive=1`, token);
  const entries: TreeEntry[] = Array.isArray(tree?.tree) ? tree.tree : [];
  const totalInTree = entries.filter((entry) => entry.type === "blob").length;

  const eligible = entries
    .filter((entry) => entry.type === "blob" && shouldReadRepositoryPath(entry.path))
    .sort((a, b) => repositoryPathPriority(b.path) - repositoryPathPriority(a.path) || a.path.localeCompare(b.path));

  const candidates = eligible.slice(0, MAX_BROWSER_FILES);
  const files: Array<{ path: string; content: string }> = [];
  let totalChars = 0;
  const excludedByFileLimit = Math.max(0, eligible.length - candidates.length);

  for (let index = 0; index < candidates.length; index += 1) {
    if (totalChars >= MAX_BROWSER_TOTAL_CHARS) break;
    const entry = candidates[index];
    if (index % 10 === 0 || index === candidates.length - 1) {
      onProgress?.(`Downloading selected hosted files… ${index + 1}/${candidates.length}${excludedByFileLimit > 0 ? ` (${excludedByFileLimit.toLocaleString()} eligible files outside hosted limit)` : ""}`);
    }
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch!)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
      const response = await fetch(rawUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (!response.ok) continue;
      const remaining = MAX_BROWSER_TOTAL_CHARS - totalChars;
      const text = (await response.text()).slice(0, Math.min(MAX_BROWSER_FILE_CHARS, remaining));
      files.push({ path: entry.path, content: text });
      totalChars += text.length;
    } catch {
      // Skip a file that fails to download; the rest of the scan proceeds.
    }
  }

  if (files.length === 0) {
    throw new Error("No AI-relevant text files were found in this repository.");
  }

  return {
    files,
    repositoryName: `${owner}/${repo}`,
    branch: branch!,
    stats: {
      totalInTree,
      eligible: eligible.length,
      queued: files.length,
      estimatedChars: totalChars,
      excludedByFileLimit,
      excludedByPayloadLimit: Math.max(0, candidates.length - files.length),
    },
  };
}
