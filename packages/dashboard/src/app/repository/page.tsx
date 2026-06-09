"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type RepoReport = any;
type SelectedObject = { kind: string; item: any } | null;
type RepositoryPayloadFile = { path: string; content: string };

const TEXT_FILE_PATTERN = /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const MAX_BROWSER_FILES = 700;
const MAX_BROWSER_FILE_CHARS = 40_000;
const IGNORED_PARTS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);
const SAMPLE_REPOSITORY_FILES = [
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

function riskLabel(report: RepoReport): string {
  const risk = report?.summary?.overallRisk;
  if (!risk || risk === "none") return "Low";
  return String(risk).charAt(0).toUpperCase() + String(risk).slice(1);
}

function confidenceLabel(value: string): string {
  if (value === "confirmed") return "Confirmed";
  if (value === "probable") return "Probable";
  if (value === "potential") return "Potential";
  return value || "Potential";
}

function nodeById(report: RepoReport): Map<string, any> {
  return new Map((report?.executionMap?.nodes || []).map((node: any) => [node.id, node]));
}

function edgeById(report: RepoReport): Map<string, any> {
  return new Map((report?.executionMap?.edges || []).map((edge: any) => [edge.id, edge]));
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
  return (report?.issues || []).filter((issue: any) =>
    (issue.impactedFiles || []).some((issueFile: string) => normalizeRepoPath(issueFile, report) === filePath)
  );
}

function objectPlaygroundHref(report: RepoReport, item: any, contentByPath: Record<string, string>): string {
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

function sourceFirstNodes(report: RepoReport, pathItem: any): any[] {
  const nodes = nodeById(report);
  return (pathItem?.nodeIds || []).map((id: string) => nodes.get(id)).filter(Boolean);
}

function severityRank(severity = ""): number {
  return ({ critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>)[severity.toLowerCase()] || 0;
}

function severityClasses(severity = ""): string {
  const normalized = severity.toLowerCase();
  if (normalized === "critical") return "border-red-200 bg-red-50 text-red-800";
  if (normalized === "high") return "border-orange-200 bg-orange-50 text-orange-800";
  if (normalized === "medium") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export default function RepositoryPage() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<RepoReport | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [contentByPath, setContentByPath] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SelectedObject>(null);
  const [activeTab, setActiveTab] = useState("Files");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sampleStartedRef = useRef(false);

  const highestPath = report?.reachablePaths?.[0];
  const nodes = useMemo(() => nodeById(report), [report]);
  const edges = useMemo(() => edgeById(report), [report]);
  const topIssues = useMemo(() => [...(report?.issues || [])].sort((left: any, right: any) =>
    severityRank(right.severity) - severityRank(left.severity) ||
    (right.confidence?.score || 0) - (left.confidence?.score || 0) ||
    left.id.localeCompare(right.id)
  ), [report]);
  const impactedFiles = useMemo(() => {
    const byFile = new Map<string, { file: string; issues: any[]; highestSeverity: string }>();
    for (const issue of report?.issues || []) {
      for (const rawFile of issue.impactedFiles || []) {
        const file = normalizeRepoPath(rawFile, report);
        const current = byFile.get(file) || { file, issues: [], highestSeverity: "low" };
        current.issues.push(issue);
        if (severityRank(issue.severity) > severityRank(current.highestSeverity)) current.highestSeverity = issue.severity;
        byFile.set(file, current);
      }
    }
    return Array.from(byFile.values()).sort((left, right) =>
      severityRank(right.highestSeverity) - severityRank(left.highestSeverity) ||
      right.issues.length - left.issues.length ||
      left.file.localeCompare(right.file)
    );
  }, [report]);
  const inventory = useMemo(() => {
    const artifacts = report?.artifacts || [];
    return {
      Files: report?.files || artifacts,
      Skills: report?.skills || artifacts.filter((artifact: any) => artifact.type === "SKILL"),
      "MCP Servers": report?.mcpServers || artifacts.filter((artifact: any) => artifact.type === "MCP_SERVER"),
      Workflows: report?.workflows || artifacts.filter((artifact: any) => artifact.type === "WORKFLOW" || artifact.type === "ACTION"),
      Memory: artifacts.filter((artifact: any) => artifact.type === "MEMORY"),
      Tools: artifacts.filter((artifact: any) => artifact.type === "TOOL"),
      Findings: report?.issues || [],
      Evidence: report?.evidence || [],
      "Fix Plan": report?.fixPlan || [],
      Report: report ? [report] : [],
    } as Record<string, any[]>;
  }, [report]);

  useEffect(() => {
    if (sampleStartedRef.current) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("sample") !== "1") return;
    sampleStartedRef.current = true;
    void scanSampleRepository();
  }, []);

  async function handleFiles(selectedFiles: FileList | null) {
    const nextFiles = Array.from(selectedFiles || []).filter(shouldRead).slice(0, MAX_BROWSER_FILES);
    setFiles(nextFiles);
    setReport(null);
    setSelected(null);
    setError(null);
  }

  async function scanPayloadFiles(payloadFiles: RepositoryPayloadFile[], repositoryName: string) {
    const res = await fetch("/api/repository", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: payloadFiles, repositoryName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `Repository scan failed (${res.status})`);
    setReport(data.report);
    setScanMeta(data.scan);
    setContentByPath(payloadFiles.reduce((acc, file) => {
      const normalized = normalizeRepoPath(file.path);
      acc[normalized] = file.content;
      acc[normalized.split("/").slice(-1)[0]] = file.content;
      return acc;
    }, {} as Record<string, string>));
    setActiveTab("Files");
    setSelected(null);
  }

  async function scanRepository() {
    setError(null);
    if (files.length === 0) {
      setError(repositoryUrl.trim() ? "GitHub URL scanning is not fetched by the browser UI yet. Use the CLI command below or upload a folder." : "Upload a repository folder to run browser-bounded analysis.");
      return;
    }
    setLoading(true);
    try {
      const payloadFiles = await Promise.all(files.map(async (file) => ({
        path: fileDisplayName(file),
        content: (await file.text()).slice(0, MAX_BROWSER_FILE_CHARS),
      })));
      await scanPayloadFiles(payloadFiles, files[0] ? fileDisplayName(files[0]).split("/")[0] : "Uploaded repository");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repository scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function scanSampleRepository() {
    setError(null);
    setLoading(true);
    setFiles([]);
    setRepositoryUrl("");
    try {
      await scanPayloadFiles(SAMPLE_REPOSITORY_FILES, "Sample AI review repository");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sample repository scan failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FAF9F6] text-[#1C1917]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
        <header className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar Repository Explorer</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">AI Execution Path Analysis for full repositories</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#57534E]">Repository Explorer is the map. Playground is the microscope.</p>
        </header>

        <section className="grid gap-3 rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm lg:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 lg:col-span-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Demo repository</span>
                <p className="mt-1 text-sm font-semibold leading-5 text-[#57534E]">Run a built-in AI review repo with prompt, skill, MCP, memory, workflow, tool router, shell, filesystem, and external API reachability.</p>
              </div>
              <button onClick={scanSampleRepository} disabled={loading} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "Analyzing..." : "Run Sample Repository"}</button>
            </div>
          </div>
          <label className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
            <span className="text-xs font-black">GitHub repository URL</span>
            <input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/org/repo" className="mt-3 w-full rounded-xl border border-[#E4E3DE] bg-white px-3 py-2 text-xs font-semibold outline-none" />
            <span className="mt-2 block text-[11px] font-semibold text-[#78716C]">Use CLI for exhaustive remote scans.</span>
          </label>
          <label className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF9F6] p-4">
            <span className="text-xs font-black">ZIP upload</span>
            <span className="mt-3 block text-[11px] font-semibold text-[#78716C]">ZIP decompression is routed to the CLI until browser extraction is connected.</span>
            <input type="file" accept=".zip" className="sr-only" />
          </label>
          <label className="cursor-pointer rounded-xl border border-dashed border-slate-900 bg-white p-4">
            <span className="text-xs font-black">Folder upload</span>
            <span className="mt-3 block text-[11px] font-semibold text-[#78716C]">{files.length ? `${files.length} readable files selected` : "Select a repository folder for bounded browser analysis."}</span>
            <input type="file" multiple className="sr-only" onChange={(event) => handleFiles(event.target.files)} {...({ webkitdirectory: "true", directory: "true" } as any)} />
          </label>
          <div className="lg:col-span-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="rounded-xl bg-slate-950 px-4 py-3 font-mono text-xs font-bold text-white">npx @promptsonar/cli repo . --json --output repository-report.json</code>
            <button onClick={scanRepository} disabled={loading} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{loading ? "Analyzing repository..." : "Analyze Repository"}</button>
          </div>
          {error && <p className="lg:col-span-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
        </section>

        {report && (
          <>
            <section className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">1. Repository Summary</p>
                <h2 className="mt-1 text-xl font-black tracking-tight">What needs attention in this repository</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {[
                  ["Overall Risk", riskLabel(report)],
                  ["Trust Status", report.summary.trustStatus],
                  ["Issues", report.issueSummary?.total || 0],
                  ["Impacted Files", impactedFiles.length],
                  ["Critical / High", `${report.issueSummary?.critical || 0} / ${report.issueSummary?.high || 0}`],
                  ["Reachable Paths", report.summary.reachablePaths || report.reachablePaths.length],
                ].map(([label, value]) => (
                  <button key={label} onClick={() => setSelected({ kind: "summary", item: { label, value } })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left transition hover:border-slate-400">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{label}</span>
                    <span className="mt-1 block break-words font-mono text-lg font-black">{value}</span>
                  </button>
                ))}
              </div>
              <details className="mt-4 border-t border-[#E4E3DE] pt-3">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-[#57534E]">More repository metrics</summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["AI Files Analyzed", report.summary.filesScanned || 0],
                    ["AI Surfaces", report.summary.aiSurfaces || 0],
                    ["Sensitive Actions", report.summary.sensitiveActions || 0],
                    ["Confirmed", report.summary.confirmedPaths || 0],
                    ["Probable", report.summary.probablePaths || 0],
                    ["Potential", report.summary.potentialPaths ?? 0],
                  ].map(([label, value]) => <div key={label} className="rounded-lg bg-[#FAF9F6] p-3"><span className="block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">{label}</span><span className="mt-1 block font-mono text-base font-black">{value}</span></div>)}
                </div>
              </details>
            </section>

            <section className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">2. Top Issues</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight">Fix these first</h2>
                </div>
                <span className="text-xs font-bold text-[#78716C]">{report.issueSummary?.total || 0} active issues</span>
              </div>
              <div className="mt-4 divide-y divide-[#E4E3DE] border-y border-[#E4E3DE]">
                {topIssues.slice(0, 4).map((issue: any) => (
                  <button key={issue.id} onClick={() => setSelected({ kind: "Findings", item: issue })} className="grid w-full gap-3 py-4 text-left transition hover:bg-[#FAF9F6] sm:grid-cols-[120px_1fr_220px] sm:px-2">
                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${severityClasses(issue.severity)}`}>{issue.severity}</span>
                      <span className="mt-2 block text-[10px] font-bold text-[#78716C]">{issue.confidence?.label} · {issue.confidence?.score}%</span>
                    </div>
                    <div className="min-w-0">
                      <span className="block font-mono text-[10px] font-black text-[#78716C]">{issue.id}</span>
                      <span className="mt-1 block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Issue</span>
                      <span className="mt-1 block text-sm font-black text-[#1C1917]">{issue.issue}</span>
                      <span className="mt-3 block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Impact</span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-[#57534E]">{issue.impact}</span>
                      <span className="mt-3 block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Why this matters</span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-[#57534E]">{issue.whyThisMatters}</span>
                      <span className="mt-3 block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Fix</span>
                      <span className="mt-1 block text-xs font-semibold leading-5 text-[#57534E]">{issue.howToFix}</span>
                    </div>
                    <div className="text-xs font-semibold text-[#57534E]">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Technical Details</span>
                      <span className="mt-1 block leading-5">{issue.technicalDetails?.executionPath || "No connected sensitive action confirmed."}</span>
                      <span className="mt-3 block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Affected</span>
                      <span className="mt-1 block truncate font-mono">{issue.impactedFiles?.[0] || "Unknown file"}</span>
                      <span className="mt-2 block">{issue.evidence?.length || 0} evidence item{issue.evidence?.length === 1 ? "" : "s"} · {issue.confidence?.label} {issue.confidence?.score}%</span>
                      <span className="mt-2 block text-[10px] font-black uppercase text-slate-900">Inspect issue</span>
                    </div>
                  </button>
                ))}
                {topIssues.length === 0 && <p className="py-6 text-sm font-bold text-emerald-700">No active repository issues.</p>}
              </div>
              {topIssues.length > 4 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-black text-slate-900">Show {topIssues.length - 4} additional issues</summary>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {topIssues.slice(4).map((issue: any) => (
                      <button key={issue.id} onClick={() => setSelected({ kind: "Findings", item: issue })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${severityClasses(issue.severity)}`}>{issue.severity}</span>
                        <span className="mt-2 block truncate font-mono text-[10px] font-black">{issue.id}</span>
                        <span className="mt-2 block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">Issue</span>
                        <span className="mt-1 block text-xs font-semibold">{issue.issue}</span>
                        <span className="mt-2 block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">Impact</span>
                        <span className="mt-1 block text-[11px] font-semibold text-[#57534E]">{issue.impact}</span>
                        <span className="mt-2 block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">Why this matters</span>
                        <span className="mt-1 block text-[11px] font-semibold text-[#57534E]">{issue.whyThisMatters}</span>
                        <span className="mt-2 block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">Fix</span>
                        <span className="mt-1 block text-[11px] font-semibold text-[#57534E]">{issue.howToFix}</span>
                        <span className="mt-2 block text-[8px] font-black uppercase tracking-widest text-[#A8A29E]">Technical Details</span>
                        <span className="mt-1 block text-[10px] font-semibold text-[#78716C]">{issue.technicalDetails?.executionPath || "No connected sensitive action confirmed."} · {issue.confidence?.label} {issue.confidence?.score}%</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              {selected && <details open className="mt-4 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4"><summary className="cursor-pointer text-xs font-black">Selected object analysis</summary><ObjectPanel report={report} selected={selected} contentByPath={contentByPath} /></details>}
            </section>

            <section className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">3. Impacted Files</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight">Where the issues live</h2>
                </div>
                <span className="text-xs font-bold text-[#78716C]">{impactedFiles.length} files</span>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {impactedFiles.slice(0, 6).map(file => (
                  <button key={file.file} onClick={() => setSelected({ kind: "Files", item: { id: `file:${file.file}`, name: file.file, relativePath: file.file, description: `${file.issues.length} active issues in this file.` } })} className="flex items-center justify-between gap-3 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left transition hover:border-slate-400">
                    <div className="min-w-0"><span className="block truncate font-mono text-xs font-black">{file.file}</span><span className="mt-1 block text-[10px] font-semibold text-[#78716C]">{file.issues.length} issue{file.issues.length === 1 ? "" : "s"}</span></div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[8px] font-black uppercase ${severityClasses(file.highestSeverity)}`}>{file.highestSeverity}</span>
                  </button>
                ))}
                {impactedFiles.length === 0 && <p className="text-sm font-bold text-emerald-700">No files are impacted by active issues.</p>}
              </div>
              {impactedFiles.length > 6 && <details className="mt-3"><summary className="cursor-pointer text-xs font-black">Show {impactedFiles.length - 6} additional files</summary><div className="mt-3 grid gap-2 md:grid-cols-2">{impactedFiles.slice(6).map(file => <button key={file.file} onClick={() => setSelected({ kind: "Files", item: { id: `file:${file.file}`, name: file.file, relativePath: file.file, description: `${file.issues.length} active issues in this file.` } })} className="rounded-lg border border-[#E4E3DE] p-3 text-left font-mono text-xs font-bold">{file.file} · {file.issues.length}</button>)}</div></details>}
            </section>

            <section className="rounded-2xl border border-red-200 bg-red-50/30 p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-700">4. Highest Risk Path</p>
                  {highestPath ? (
                    <>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {sourceFirstNodes(report, highestPath).map((node, index) => (
                          <React.Fragment key={node.id}>
                            {index > 0 && <span className="text-slate-400">→</span>}
                            <button onClick={() => setSelected({ kind: "node", item: node })} className="rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-black">{node.label}</button>
                          </React.Fragment>
                        ))}
                      </div>
                      <p className="mt-4 text-sm font-semibold text-[#44403C]"><span className="font-black">Risk:</span> {highestPath.explanation}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-wider">
                        <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-red-700">Action: {highestPath.sensitiveAction || highestPath.sensitiveActions?.[0] || "Sensitive action"}</span>
                        <span className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-red-700">Confidence: {highestPath.confidenceLabel || confidenceLabel(highestPath.confidenceLevel)}</span>
                        <span className="rounded-full border border-[#E4E3DE] bg-white px-2.5 py-1">Files: {highestPath.files?.length || 0}</span>
                      </div>
                    </>
                  ) : <p className="mt-3 text-sm font-bold text-emerald-700">No reachable sensitive action paths found.</p>}
                </div>
                {highestPath && <button onClick={() => setSelected({ kind: "path", item: highestPath })} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">Inspect Path</button>}
              </div>
            </section>

            <section className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">5. Fix Plan</p>
                <h2 className="mt-1 text-xl font-black tracking-tight">Prioritized remediation</h2>
              </div>
              <ol className="mt-4 divide-y divide-[#E4E3DE] border-y border-[#E4E3DE]">
                {topIssues.slice(0, 4).map((issue: any, index: number) => (
                  <li key={issue.id} className="grid gap-3 py-4 sm:grid-cols-[36px_1fr_auto] sm:items-start">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 font-mono text-xs font-black text-white">{index + 1}</span>
                    <div><span className="block text-sm font-black">{issue.howToFix}</span><span className="mt-1 block font-mono text-[10px] font-bold text-[#78716C]">{issue.id} · {(issue.impactedFiles || []).join(", ")}</span></div>
                    <button onClick={() => setSelected({ kind: "Findings", item: issue })} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2 text-[10px] font-black uppercase">Review</button>
                  </li>
                ))}
              </ol>
              {(topIssues.length > 4 || (report.fixPlan || []).length > 0) && <details className="mt-3"><summary className="cursor-pointer text-xs font-black">Show complete fix plan</summary><div className="mt-3 grid gap-2">{topIssues.slice(4).map((issue: any) => <button key={issue.id} onClick={() => setSelected({ kind: "Findings", item: issue })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left text-xs font-semibold"><span className="font-mono font-black">{issue.id}</span><span className="mt-1 block">{issue.howToFix}</span></button>)}{(report.fixPlan || []).map((fix: any, index: number) => <button key={`${fix.id}-${index}`} onClick={() => setSelected({ kind: "Fix Plan", item: fix })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left text-xs font-semibold"><span className="font-black">{fix.title}</span><span className="mt-1 block text-[#57534E]">{fix.description}</span></button>)}</div></details>}
            </section>

            <details className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-3">
                  <div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">6. Execution Map</p><h2 className="mt-1 text-xl font-black tracking-tight">Trace nodes and relationships</h2></div>
                  <span className="text-xs font-bold text-[#57534E]">{report.executionMap.nodes.length} nodes · {report.executionMap.edges.length} edges · Expand</span>
                </div>
              </summary>
              <div className="mt-5">
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  {report.executionMap.nodes.map((node: any) => (
                    <button key={node.id} onClick={() => setSelected({ kind: "node", item: node })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left">
                      <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{node.type}</span>
                      <span className="mt-1 block text-xs font-black">{node.label}</span>
                      <span className="mt-1 block truncate text-[10px] font-semibold text-[#78716C]">{node.relativePath || node.description}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 overflow-x-auto rounded-xl border border-[#E4E3DE]">
                  <table className="w-full min-w-[760px] text-left text-[11px]">
                    <thead className="bg-[#FAF9F6] text-[9px] uppercase tracking-widest text-[#A8A29E]"><tr><th className="p-2">From</th><th className="p-2">Relationship</th><th className="p-2">To</th><th className="p-2">Evidence</th><th className="p-2">Confidence</th></tr></thead>
                    <tbody>{report.executionMap.edges.map((edge: any) => <tr key={edge.id} className="border-t border-[#E4E3DE]"><td className="p-2 font-bold">{nodes.get(edge.from)?.label || edge.from}</td><td className="p-2">{edge.relationship || edge.type}</td><td className="p-2 font-bold">{nodes.get(edge.to)?.label || edge.to}</td><td className="p-2">{edge.evidence || edge.reason}</td><td className="p-2 font-mono">{edge.confidenceLabel || confidenceLabel(edge.confidenceLabel)}</td></tr>)}</tbody>
                  </table>
                </div>
                {selected && <div className="mt-4 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4"><ObjectPanel report={report} selected={selected} contentByPath={contentByPath} /></div>}
              </div>
            </details>

            <details className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">7. Evidence</p><h2 className="mt-1 text-xl font-black tracking-tight">Scanner and graph provenance</h2></div><span className="text-xs font-bold text-[#57534E]">{report.evidence?.length || 0} records · Expand</span></div></summary>
              <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(report.evidence || []).slice(0, 120).map((item: any) => <button key={item.id} onClick={() => setSelected({ kind: "Evidence", item })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left"><span className="block font-mono text-[10px] font-black">{item.id}</span><span className="mt-1 block truncate text-xs font-semibold">{item.file || item.source}</span><span className="mt-1 block line-clamp-2 text-[10px] text-[#78716C]">{item.snippet}</span></button>)}
              </div>
            </details>

            <details className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">8. Report</p><h2 className="mt-1 text-xl font-black tracking-tight">Canonical report and exports</h2></div><span className="text-xs font-bold text-[#57534E]">{report.id} · Expand</span></div></summary>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-[#FAF9F6] p-4"><span className="text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Report version</span><span className="mt-1 block font-mono text-sm font-black">{report.version}</span></div>
                <div className="rounded-xl bg-[#FAF9F6] p-4"><span className="text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Scan mode</span><span className="mt-1 block font-mono text-sm font-black">{report.scanMode || "unknown"}</span></div>
                <div className="rounded-xl bg-[#FAF9F6] p-4"><span className="text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">Generated</span><span className="mt-1 block font-mono text-sm font-black">{report.generated_at}</span></div>
              </div>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-[10px] text-slate-100">{JSON.stringify({ id: report.id, issueSummary: report.issueSummary, summary: report.summary, exports: report.exports }, null, 2)}</pre>
            </details>

            <details className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.2em] text-[#57534E]">Repository Browser · all existing tabs</summary>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.keys(inventory).map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider ${activeTab === tab ? "border-slate-900 bg-slate-900 text-white" : "border-[#E4E3DE] bg-[#FAF9F6]"}`}>{tab}</button>)}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(inventory[activeTab] || []).slice(0, 120).map((item: any, index: number) => (
                  <button key={item.id || `${activeTab}-${index}`} onClick={() => setSelected({ kind: activeTab, item })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{item.type || item.severity || item.ruleId || item.rule_id || activeTab}</span>
                    <span className="mt-1 block truncate text-xs font-black">{item.label || item.name || item.id || item.ruleId || item.rule_id || activeTab}</span>
                    <span className="mt-1 block truncate text-[10px] font-semibold text-[#78716C]">{item.relativePath || item.file || item.filePath || item.description || item.message || item.title}</span>
                  </button>
                ))}
              </div>
            </details>

            {scanMeta && <p className="text-center text-xs font-semibold text-[#78716C]">Browser-bounded scan: {scanMeta.filesWritten} files scanned, {scanMeta.filesSkipped} skipped. Use CLI for exhaustive analysis.</p>}
          </>
        )}
      </div>
    </main>
  );
}

function ObjectPanel({ report, selected, contentByPath }: { report: RepoReport; selected: NonNullable<SelectedObject>; contentByPath: Record<string, string> }) {
  const item = selected.item;
  const edges = report.executionMap.edges || [];
  const incoming = edges.filter((edge: any) => edge.to === item.id);
  const outgoing = edges.filter((edge: any) => edge.from === item.id);
  const connectedPaths = (report.reachablePaths || []).filter((pathItem: any) => pathItem.nodeIds?.includes(item.id) || pathItem.edgeIds?.includes(item.id) || pathItem.id === item.id);
  const filePath = filePathForObject(report, item);
  const fileFindings = findingsForFile(report, filePath);
  const isIssue = Boolean(item?.ruleId || item?.rule_id);
  const selectedFindingCount = isIssue ? 1 : fileFindings.length;
  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">{selected.kind}</p>
        <h3 className="mt-1 break-words text-lg font-black">{item.label || item.name || item.id || item.ruleId || item.rule_id || selected.kind}</h3>
        <p className="mt-2 text-xs font-semibold leading-5 text-[#57534E]">{item.description || item.issue || item.message || item.explanation || "Repository object selected for analysis."}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Incoming<br /><span className="font-mono text-lg">{incoming.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Outgoing<br /><span className="font-mono text-lg">{outgoing.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Connected paths<br /><span className="font-mono text-lg">{connectedPaths.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">
          {isIssue ? "Selected issue" : "File issues"}<br />
          <span className="font-mono text-lg">{selectedFindingCount}</span>
          {isIssue && <span className="ml-2 text-[10px] text-[#78716C]">{fileFindings.length} in file</span>}
        </div>
      </div>
      {isIssue && (
        <div className="grid gap-3">
          {[
            ["Issue", item.issue],
            ["Impact", item.impact],
            ["Why this matters", item.whyThisMatters],
            ["Fix", item.howToFix],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-[#E4E3DE] bg-white p-3"><span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{label}</span><p className="mt-1 text-xs font-semibold leading-5 text-[#57534E]">{value}</p></div>)}
        </div>
      )}
      <details open className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">
        <summary className="cursor-pointer text-xs font-black">Technical Details</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] font-semibold text-[#57534E]">{JSON.stringify({ executionPath: item.technicalDetails?.executionPath, evidence: item.technicalDetails?.evidence || item.evidence || item.evidenceRefs || item.snippet, confidence: item.technicalDetails?.confidence || item.confidence, metadata: item.metadata, incoming, outgoing }, null, 2)}</pre>
      </details>
      {!isIssue && <p className="rounded-xl border border-[#E4E3DE] bg-white p-3 text-xs font-semibold leading-5 text-[#57534E]">Suggested fix: {item.howToFix || "Scope permissions, require explicit approval before sensitive actions, and remove unnecessary access to sensitive operations."}</p>}
      <a href={objectPlaygroundHref(report, item, contentByPath)} className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">Open in Playground →</a>
    </div>
  );
}
