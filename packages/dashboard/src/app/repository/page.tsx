"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildImpactedFileViews } from "../../lib/repositoryImpactedFiles";
import {
  plainTrust,
  plainSeverity,
  plainOverallRisk,
  plainConfidence,
  plainArtifactType,
  plainAction,
  plainProvenance,
  toneClasses,
  severityRank,
  type Tone,
} from "../../lib/plainLanguage";

type RepoReport = any;
type RepositoryPayloadFile = { path: string; content: string };

const TEXT_FILE_PATTERN = /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const MAX_BROWSER_FILES = 700;
const MAX_BROWSER_FILE_CHARS = 40_000;
const IGNORED_PARTS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);

const SAMPLE_REPOSITORY_FILES: RepositoryPayloadFile[] = [
  {
    path: "prompts/reviewer.prompt",
    content: `System prompt: You are the repository reviewer agent.

Use the code-review skill for every pull request. If the user asks for a dependency recovery, route the request to tool-router and run shell commands through the filesystem MCP server. Include environment context when calling external APIs.`,
  },
  {
    path: "skills/code-review/SKILL.md",
    content: `# Code Review Skill

Use when reviewing pull requests, dependency failures, or CI recovery tasks.

Capabilities:
- inspect repository files
- call tool-router
- request filesystem writes
- run shell recovery commands

Important: approval is required before destructive operations, but the tool-router is allowed to continue when CI is blocked.`,
  },
  {
    path: "tools/tool-router.yaml",
    content: `tools:
  - name: filesystem.write_file
    routes_to: filesystem-mcp
  - name: shell.run_command
    routes_to: filesystem-mcp
  - name: external_api.post_review
    routes_to: network
policy:
  approval: optional
  review_status: post results after tool execution`,
  },
  {
    path: ".cursor/mcp.json",
    content: JSON.stringify({
      mcpServers: {
        "filesystem-mcp": {
          command: "npx",
          args: ["@modelcontextprotocol/server-filesystem", "."],
          autoApprove: true,
          tools: ["read_file", "write_file", "shell.run_command"],
          permissions: ["filesystem", "shell", "network", "secrets"],
        },
      },
    }, null, 2),
  },
  {
    path: ".github/workflows/ai-review.yml",
    content: `name: AI review
on:
  pull_request:
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run agent review
        run: npx promptsonar-agent --prompt prompts/reviewer.prompt --tool-router tools/tool-router.yaml
        env:
          REVIEW_API_TOKEN: \${{ secrets.REVIEW_API_TOKEN }}`,
  },
  {
    path: "memory/reviewer-memory.json",
    content: JSON.stringify({
      memory: "Remember prior reviewer decisions and reuse the last approved review policy for external status updates.",
    }, null, 2),
  },
  {
    path: "README.md",
    content: `# Sample AI Review Repository

This intentionally small sample demonstrates a repository execution path from a prompt to a skill, tool router, MCP filesystem server, shell execution, credential usage, and an external API.`,
  },
];

function fileDisplayName(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function shouldRead(file: File): boolean {
  const name = fileDisplayName(file).replace(/\\/g, "/");
  if (name.split("/").some(part => IGNORED_PARTS.has(part))) return false;
  return TEXT_FILE_PATTERN.test(name.toLowerCase()) || file.type.startsWith("text/");
}

function normalizeRepoPath(value = "", report?: RepoReport): string {
  const normalized = value.replace(/\\/g, "/");
  const root = report?.repository?.root ? String(report.repository.root).replace(/\\/g, "/") : "";
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return normalized.replace(/^\/+/, "");
}

function filePathForObject(report: RepoReport, item: any): string {
  const directPath = item?.relativePath || item?.path || item?.file || item?.filePath || "";
  if (directPath) return normalizeRepoPath(directPath, report);
  if (Array.isArray(item?.impactedFiles) && item.impactedFiles.length > 0) return normalizeRepoPath(item.impactedFiles[0], report);
  if (Array.isArray(item?.files) && item.files.length > 0) return normalizeRepoPath(item.files[0], report);
  return "";
}

function findingsForFile(report: RepoReport, filePath: string): any[] {
  if (!filePath) return [];
  const indexedFile = (report?.impactedFiles || []).find((file: any) => normalizeRepoPath(file.path, report) === filePath);
  if (indexedFile?.issueIds) {
    const issuesById = new Map((report?.issues || []).map((issue: any) => [issue.id, issue]));
    return indexedFile.issueIds.map((id: string) => issuesById.get(id)).filter(Boolean);
  }
  return (report?.issues || []).filter((issue: any) =>
    (issue.impactedFiles || []).some((issueFile: string) => normalizeRepoPath(issueFile, report) === filePath)
  );
}

// Builds the /playground link and stashes the file content + finding in
// sessionStorage so the next screen shows the full result without re-fetching.
function playgroundHref(report: RepoReport, item: any, contentByPath: Record<string, string>): string {
  const params = new URLSearchParams();
  if (report?.id) params.set("scanId", report.id);
  const filePath = filePathForObject(report, item);
  if (filePath) params.set("file", filePath);
  const objectId = item?.id || item?.ruleId || item?.rule_id || "";
  const isIssue = Boolean(item?.ruleId || item?.rule_id);
  if (item?.id) params.set(item.nodeIds ? "pathId" : isIssue ? "findingId" : "artifactId", item.id);
  else if (isIssue) params.set("findingId", item.ruleId || item.rule_id);
  const content = contentByPath[filePath] || contentByPath[filePath.split("/").slice(-1)[0]];
  if (content && typeof window !== "undefined") {
    const fileFindings = findingsForFile(report, filePath);
    const selectedFinding = isIssue
      ? fileFindings.find((finding: any) => finding.id === item.id) || { ...item }
      : undefined;
    const handoffKey = `repo-handoff:${report?.id || "scan"}:${objectId || filePath}`;
    window.sessionStorage.setItem(handoffKey, JSON.stringify({
      source: "repository",
      kind: "repository-object",
      file: filePath,
      objectId,
      content,
      selectedFinding,
      fileFindings,
      repositorySummary: report?.summary,
    }));
    params.set("source", "repository");
    params.set("handoffKey", handoffKey);
  }
  return `/playground?${params.toString()}`;
}

// ── Small shared UI atoms ──────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{children}</p>;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClasses(tone)}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-border bg-card shadow-xs ${className}`}>{children}</section>;
}

const TONE_ACCENT: Record<Tone, string> = {
  danger: "bg-red-500",
  warn: "bg-amber-500",
  caution: "bg-sky-500",
  safe: "bg-emerald-500",
  neutral: "bg-muted-foreground/40",
};

export default function RepositoryPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<RepoReport | null>(null);
  const [contentByPath, setContentByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showConnections, setShowConnections] = useState(false);
  const sampleStartedRef = useRef(false);

  const nodesById = useMemo(
    () => new Map((report?.executionMap?.nodes || []).map((node: any) => [node.id, node])),
    [report]
  );
  const issues = useMemo(() => {
    const NON_PROD = new Set(["documentation", "test", "fixture", "example", "generated"]);
    const isProd = (i: any) => !NON_PROD.has(i.provenance ?? "production");
    return [...(report?.issues || [])].sort((a: any, b: any) =>
      (isProd(b) ? 1 : 0) - (isProd(a) ? 1 : 0) ||
      severityRank(b.severity) - severityRank(a.severity) ||
      (b.confidence?.score || 0) - (a.confidence?.score || 0) ||
      String(a.id).localeCompare(String(b.id))
    );
  }, [report]);
  const impactedFiles = useMemo(() => buildImpactedFileViews(report), [report]);
  const topPath = report?.reachablePaths?.[0];

  useEffect(() => {
    if (sampleStartedRef.current || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("sample") !== "1") return;
    sampleStartedRef.current = true;
    void scanSample();
  }, []);

  function handleFiles(selectedFiles: FileList | null) {
    const next = Array.from(selectedFiles || []).filter(shouldRead).slice(0, MAX_BROWSER_FILES);
    setFiles(next);
    setReport(null);
    setError(null);
  }

  async function scanPayload(payloadFiles: RepositoryPayloadFile[], repositoryName: string) {
    const res = await fetch("/api/repository", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payloadFiles, repositoryName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Scan failed (${res.status})`);
    setReport(data.report);
    setContentByPath(payloadFiles.reduce((acc, file) => {
      const normalized = normalizeRepoPath(file.path);
      acc[normalized] = file.content;
      acc[normalized.split("/").slice(-1)[0]] = file.content;
      return acc;
    }, {} as Record<string, string>));
    setShowAllIssues(false);
  }

  async function scanRepository() {
    setError(null);
    if (files.length === 0) {
      setError("Choose a repository folder to scan, or run the sample below.");
      return;
    }
    setLoading(true);
    try {
      const payloadFiles = await Promise.all(files.map(async (file) => ({
        path: fileDisplayName(file),
        content: (await file.text()).slice(0, MAX_BROWSER_FILE_CHARS),
      })));
      await scanPayload(payloadFiles, fileDisplayName(files[0]).split("/")[0] || "Your repository");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function scanSample() {
    setError(null);
    setLoading(true);
    setFiles([]);
    try {
      await scanPayload(SAMPLE_REPOSITORY_FILES, "Sample AI review repository");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const trust = plainTrust(report?.summary?.trustStatus);
  const prod = report?.summary?.productionIssueSummary;
  const nonProd = report?.summary?.nonProductionIssueSummary;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
        {/* ── Header ── */}
        <header className="mb-10">
          <Eyebrow>Repository scan</Eyebrow>
          <h1 className="mt-3 font-playfair text-[34px] font-normal leading-[1.1] tracking-tight sm:text-[42px]">
            See where your AI instructions can go
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.7] text-muted-foreground">
            Point PromptSonar at a repository. It reads your prompts, skills, connected tools,
            and workflows, then shows you — in plain language — which instructions could reach a
            risky action like running commands or touching secrets, and exactly how to close the gap.
          </p>
        </header>

        {/* ── Scan entry (only before a report) ── */}
        {!report && (
          <Card className="overflow-hidden">
            <div className="border-b border-border p-6">
              <label className="group flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 px-6 py-12 text-center transition hover:border-foreground/30 hover:bg-secondary">
                <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
                </svg>
                <span className="mt-4 text-[15px] font-medium text-foreground">
                  {files.length ? `${files.length} files ready to scan` : "Choose a repository folder"}
                </span>
                <span className="mt-1 text-[13px] text-muted-foreground">
                  {files.length ? "Click scan to analyze them." : "We read it locally in your browser — nothing is uploaded to scan."}
                </span>
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => handleFiles(event.target.files)}
                  {...({ webkitdirectory: "true", directory: "true" } as any)}
                />
              </label>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  onClick={scanRepository}
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-[14px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "Reading your files…" : "Scan this repository"}
                </button>
                <button
                  onClick={scanSample}
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-[14px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
                >
                  Try a sample repository
                </button>
              </div>
              {error && (
                <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">{error}</p>
              )}
            </div>

            <div className="flex flex-col gap-3 bg-secondary/40 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-medium text-foreground">Scanning a large or private repo?</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Run the full scan from your terminal — no upload, no limits.</p>
              </div>
              <code className="rounded-lg bg-primary px-4 py-2.5 font-mono text-[12px] text-primary-foreground">npx @promptsonar/cli repo .</code>
            </div>
          </Card>
        )}

        {/* ── Loading skeleton ── */}
        {loading && !report && (
          <div className="mt-6 space-y-3">
            <div className="ps-skeleton h-24 w-full" />
            <div className="ps-skeleton h-40 w-full" />
          </div>
        )}

        {/* ── Results ── */}
        {report && (
          <div className="space-y-6">
            {/* Verdict */}
            <Card className="overflow-hidden">
              <div className="flex">
                <div className={`w-1.5 shrink-0 ${TONE_ACCENT[trust.tone]}`} />
                <div className="flex-1 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <Eyebrow>{report.repository?.name || "Repository"} · scan result</Eyebrow>
                      <h2 className="mt-2 font-playfair text-[28px] font-normal leading-tight tracking-tight">{trust.label}</h2>
                      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-muted-foreground">{trust.sub}</p>
                    </div>
                    <button
                      onClick={() => { setReport(null); setFiles([]); }}
                      className="rounded-lg border border-border bg-card px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition hover:bg-secondary"
                    >
                      New scan
                    </button>
                  </div>

                  {/* Stat row */}
                  <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                    {[
                      ["Files checked", report.summary?.scanStats?.filesScanned ?? report.summary?.filesScanned ?? "—"],
                      ["Issues to fix", (prod?.total ?? report.issueSummary?.total) || 0],
                      ["Files affected", impactedFiles.length],
                      ["Highest risk", plainOverallRisk(report.summary?.overallRisk).label],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="bg-card p-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">{label}</div>
                        <div className="mt-1.5 text-[20px] font-medium tracking-tight">{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Production vs non-production, in plain words */}
                  {nonProd && nonProd.total > 0 && (
                    <p className="mt-4 text-[13px] leading-[1.6] text-muted-foreground">
                      <span className="font-medium text-foreground">{prod?.total ?? 0}</span> of these are in code you ship.
                      The other <span className="font-medium text-foreground">{nonProd.total}</span> are only in docs, tests, or examples —
                      we show them, but they don&apos;t count against your repository.
                    </p>
                  )}

                  {report.pathValidation && !report.pathValidation.valid && (
                    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium text-amber-800">
                      Some traced paths couldn&apos;t be fully verified. Treat the path results below as a guide, not a guarantee.
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {/* What to fix first */}
            <Card className="p-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <Eyebrow>What to fix first</Eyebrow>
                  <h3 className="mt-2 font-playfair text-[22px] font-normal tracking-tight">
                    {issues.length ? "Ordered by impact" : "Nothing needs fixing"}
                  </h3>
                </div>
                {issues.length > 0 && (
                  <span className="text-[13px] text-muted-foreground">{issues.length} found</span>
                )}
              </div>

              {issues.length === 0 ? (
                <p className="mt-4 text-[14px] text-emerald-700">No instructions in this repository can reach a risky action. Nice.</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {(showAllIssues ? issues : issues.slice(0, 5)).map((issue: any) => {
                    const sev = plainSeverity(issue.severity);
                    const prov = plainProvenance(issue.provenance);
                    const conf = plainConfidence(issue.confidence?.label || issue.confidence?.level);
                    return (
                      <li key={issue.id}>
                        <a
                          href={playgroundHref(report, issue, contentByPath)}
                          className="group block rounded-lg border border-border bg-card p-4 transition hover:border-foreground/20 hover:shadow-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={sev.tone}>{sev.label}</Pill>
                            {!prov.isProduction && (
                              <span className="text-[11px] font-medium text-muted-foreground">{prov.label}</span>
                            )}
                            <span className="ml-auto font-mono text-[12px] text-muted-foreground">{conf.label}</span>
                          </div>
                          <p className="mt-3 text-[15px] font-medium leading-snug text-foreground">{issue.issue}</p>
                          <p className="mt-1.5 text-[13px] leading-[1.6] text-muted-foreground">{issue.whyThisMatters || issue.impact}</p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="truncate font-mono text-[12px] text-muted-foreground">{issue.impactedFiles?.[0] || "—"}</span>
                            <span className="shrink-0 text-[13px] font-medium text-foreground group-hover:underline">
                              See the fix →
                            </span>
                          </div>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}

              {issues.length > 5 && (
                <button
                  onClick={() => setShowAllIssues((value) => !value)}
                  className="mt-4 text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {showAllIssues ? "Show less" : `Show all ${issues.length} issues`}
                </button>
              )}
            </Card>

            {/* Files that need attention — each opens the playground */}
            {impactedFiles.length > 0 && (
              <Card className="p-6">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <Eyebrow>Files that need attention</Eyebrow>
                    <h3 className="mt-2 font-playfair text-[22px] font-normal tracking-tight">Open any file to see the full result</h3>
                  </div>
                  <span className="text-[13px] text-muted-foreground">{impactedFiles.length} files</span>
                </div>
                <ul className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {impactedFiles.map((file: any) => {
                    const sev = plainSeverity(file.highestSeverity);
                    return (
                      <li key={file.path}>
                        <a
                          href={playgroundHref(report, file, contentByPath)}
                          className="group flex items-center gap-4 bg-card p-4 transition hover:bg-secondary/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{plainArtifactType(file.artifactType) === "File" ? file.type : plainArtifactType(file.artifactType)}</span>
                            </div>
                            <p className="mt-1 truncate font-mono text-[13px] font-medium text-foreground">{file.path}</p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              {file.issueCount} issue{file.issueCount === 1 ? "" : "s"}
                              {file.executionPaths?.length ? ` · ${file.executionPaths.length} traced path${file.executionPaths.length === 1 ? "" : "s"}` : ""}
                            </p>
                          </div>
                          <Pill tone={sev.tone}>{sev.label}</Pill>
                          <svg className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {/* Riskiest path, told as a sentence */}
            {topPath && (
              <Card className="overflow-hidden">
                <div className="flex">
                  <div className="w-1.5 shrink-0 bg-red-500" />
                  <div className="flex-1 p-6">
                    <Eyebrow>The path that worries us most</Eyebrow>
                    <p className="mt-3 text-[15px] leading-[1.6] text-foreground">{topPath.explanation}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {(topPath.nodeIds || []).map((id: string, index: number) => {
                        const node = nodesById.get(id) as any;
                        if (!node) return null;
                        return (
                          <React.Fragment key={id}>
                            {index > 0 && <span className="text-muted-foreground/50">→</span>}
                            <span className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[12px] font-medium">
                              {node.label}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
                      <Pill tone="danger">Could: {plainAction(topPath.sensitiveAction || topPath.sensitiveActions?.[0])}</Pill>
                      <Pill tone="neutral">{plainConfidence(topPath.confidenceLevel).label}</Pill>
                    </div>
                    <p className="mt-2 text-[12px] text-muted-foreground">{plainConfidence(topPath.confidenceLevel).meaning}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* How everything connects — collapsed by default */}
            {report.executionMap?.nodes?.length > 0 && (
              <Card className="p-6">
                <button
                  onClick={() => setShowConnections((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <Eyebrow>How everything connects</Eyebrow>
                    <h3 className="mt-2 font-playfair text-[22px] font-normal tracking-tight">The map behind the findings</h3>
                  </div>
                  <span className="text-[13px] text-muted-foreground">
                    {report.executionMap.nodes.length} parts · {showConnections ? "Hide" : "Show"}
                  </span>
                </button>
                {showConnections && (
                  <div className="mt-5 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-left text-[13px]">
                      <thead className="bg-secondary/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
                        <tr>
                          <th className="p-3 font-medium">From</th>
                          <th className="p-3 font-medium">Can</th>
                          <th className="p-3 font-medium">Reach</th>
                          <th className="p-3 font-medium">How sure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.executionMap.edges.map((edge: any) => (
                          <tr key={edge.id} className="border-t border-border">
                            <td className="p-3 font-medium">{(nodesById.get(edge.from) as any)?.label || edge.from}</td>
                            <td className="p-3 text-muted-foreground">{String(edge.relationship || edge.type).toLowerCase().replace(/_/g, " ")}</td>
                            <td className="p-3 font-medium">{(nodesById.get(edge.to) as any)?.label || edge.to}</td>
                            <td className="p-3 font-mono text-[12px] text-muted-foreground">{plainConfidence(edge.confidenceLabel || edge.provenance).label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            <p className="pt-2 text-center text-[12px] text-muted-foreground">
              Browser scan reads a bounded set of files. For a complete, repeatable scan, run{" "}
              <code className="font-mono text-foreground">npx @promptsonar/cli repo .</code> in your terminal.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
