"use client";

import React, { useMemo, useState } from "react";

type RepoReport = any;
type SelectedObject = { kind: string; item: any } | null;

const TEXT_FILE_PATTERN = /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const MAX_BROWSER_FILES = 700;
const MAX_BROWSER_FILE_CHARS = 40_000;
const IGNORED_PARTS = new Set([".git", "node_modules", "dist", "build", "out", "coverage", ".next", ".turbo"]);

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

function objectPlaygroundHref(report: RepoReport, item: any): string {
  const params = new URLSearchParams();
  if (report?.id) params.set("scanId", report.id);
  if (item?.relativePath || item?.path || item?.filePath) params.set("file", item.relativePath || item.path || item.filePath);
  if (item?.id) params.set(item.nodeIds ? "pathId" : item.rule_id ? "findingId" : "artifactId", item.id);
  return `/playground?${params.toString()}`;
}

function sourceFirstNodes(report: RepoReport, pathItem: any): any[] {
  const nodes = nodeById(report);
  return (pathItem?.nodeIds || []).map((id: string) => nodes.get(id)).filter(Boolean);
}

export default function RepositoryPage() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<RepoReport | null>(null);
  const [scanMeta, setScanMeta] = useState<any>(null);
  const [selected, setSelected] = useState<SelectedObject>(null);
  const [activeTab, setActiveTab] = useState("Files");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const highestPath = report?.reachablePaths?.[0];
  const nodes = useMemo(() => nodeById(report), [report]);
  const edges = useMemo(() => edgeById(report), [report]);
  const inventory = useMemo(() => {
    const artifacts = report?.artifacts || [];
    return {
      Files: report?.files || artifacts,
      Skills: report?.skills || artifacts.filter((artifact: any) => artifact.type === "SKILL"),
      "MCP Servers": report?.mcpServers || artifacts.filter((artifact: any) => artifact.type === "MCP_SERVER"),
      Workflows: report?.workflows || artifacts.filter((artifact: any) => artifact.type === "WORKFLOW" || artifact.type === "ACTION"),
      Memory: artifacts.filter((artifact: any) => artifact.type === "MEMORY"),
      Tools: artifacts.filter((artifact: any) => artifact.type === "TOOL"),
      Findings: (report?.findings || []).flatMap((result: any) => (result.findings || []).map((finding: any) => ({ ...finding, filePath: result.filePath }))),
      Evidence: report?.evidence || [],
      "Fix Plan": report?.fixPlan || [],
      Report: report ? [report] : [],
    } as Record<string, any[]>;
  }, [report]);

  async function handleFiles(selectedFiles: FileList | null) {
    const nextFiles = Array.from(selectedFiles || []).filter(shouldRead).slice(0, MAX_BROWSER_FILES);
    setFiles(nextFiles);
    setReport(null);
    setSelected(null);
    setError(null);
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
      const res = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payloadFiles, repositoryName: files[0] ? fileDisplayName(files[0]).split("/")[0] : "Uploaded repository" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Repository scan failed (${res.status})`);
      setReport(data.report);
      setScanMeta(data.scan);
      setActiveTab("Files");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repository scan failed.");
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
            <section className="grid gap-3 rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm md:grid-cols-4 xl:grid-cols-8">
              {[
                ["Overall Risk", riskLabel(report)],
                ["Trust Status", report.summary.trustStatus],
                ["Files Scanned", report.summary.filesScanned || 0],
                ["AI Surfaces", report.summary.aiSurfaces || 0],
                ["Reachable Paths", report.summary.reachablePaths || report.reachablePaths.length],
                ["Sensitive Actions", report.summary.sensitiveActions || 0],
                ["Confirmed", report.summary.confirmedPaths || 0],
                ["Probable", report.summary.probablePaths || 0],
              ].map(([label, value]) => (
                <button key={label} onClick={() => setSelected({ kind: "summary", item: { label, value } })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{label}</span>
                  <span className="mt-1 block break-words font-mono text-lg font-black">{value}</span>
                  <span className="mt-2 block text-[10px] font-black uppercase text-slate-800">Why?</span>
                </button>
              ))}
            </section>

            <section className="rounded-2xl border border-red-200 bg-red-50/30 p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-700">Highest Risk Path</p>
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

            <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">Execution Map</h2>
                  <span className="text-xs font-bold text-[#57534E]">{report.executionMap.nodes.length} nodes · {report.executionMap.edges.length} edges</span>
                </div>
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
              </div>

              <aside className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
                <h2 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#A8A29E]">Object Analysis</h2>
                {selected ? <ObjectPanel report={report} selected={selected} /> : <p className="mt-3 text-sm font-semibold text-[#57534E]">Click a path, node, file, skill, MCP server, workflow, finding, or evidence item to inspect it.</p>}
              </aside>
            </section>

            <section className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {Object.keys(inventory).map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider ${activeTab === tab ? "border-slate-900 bg-slate-900 text-white" : "border-[#E4E3DE] bg-[#FAF9F6]"}`}>{tab}</button>)}
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {(inventory[activeTab] || []).slice(0, 120).map((item: any, index: number) => (
                  <button key={item.id || `${activeTab}-${index}`} onClick={() => setSelected({ kind: activeTab, item })} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-left">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-[#A8A29E]">{item.type || item.severity || item.rule_id || activeTab}</span>
                    <span className="mt-1 block truncate text-xs font-black">{item.label || item.name || item.rule_id || item.id || activeTab}</span>
                    <span className="mt-1 block truncate text-[10px] font-semibold text-[#78716C]">{item.relativePath || item.file || item.filePath || item.description || item.message || item.title}</span>
                  </button>
                ))}
              </div>
            </section>

            {scanMeta && <p className="text-center text-xs font-semibold text-[#78716C]">Browser-bounded scan: {scanMeta.filesWritten} files scanned, {scanMeta.filesSkipped} skipped. Use CLI for exhaustive analysis.</p>}
          </>
        )}
      </div>
    </main>
  );
}

function ObjectPanel({ report, selected }: { report: RepoReport; selected: NonNullable<SelectedObject> }) {
  const item = selected.item;
  const edges = report.executionMap.edges || [];
  const incoming = edges.filter((edge: any) => edge.to === item.id);
  const outgoing = edges.filter((edge: any) => edge.from === item.id);
  const connectedPaths = (report.reachablePaths || []).filter((pathItem: any) => pathItem.nodeIds?.includes(item.id) || pathItem.edgeIds?.includes(item.id) || pathItem.id === item.id);
  const findings = (report.findings || []).flatMap((result: any) => (result.findings || []).filter((finding: any) => finding.rule_id === item.rule_id || result.filePath === item.filePath || result.filePath === item.path));
  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">{selected.kind}</p>
        <h3 className="mt-1 break-words text-lg font-black">{item.label || item.name || item.rule_id || item.id || selected.kind}</h3>
        <p className="mt-2 text-xs font-semibold leading-5 text-[#57534E]">{item.description || item.message || item.explanation || "Repository object selected for analysis."}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Incoming<br /><span className="font-mono text-lg">{incoming.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Outgoing<br /><span className="font-mono text-lg">{outgoing.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Connected paths<br /><span className="font-mono text-lg">{connectedPaths.length}</span></div>
        <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">Findings<br /><span className="font-mono text-lg">{findings.length}</span></div>
      </div>
      <details open className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">
        <summary className="cursor-pointer text-xs font-black">Evidence and reason</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] font-semibold text-[#57534E]">{JSON.stringify({ evidence: item.evidence || item.evidenceRefs || item.snippet, metadata: item.metadata, incoming, outgoing }, null, 2)}</pre>
      </details>
      <p className="rounded-xl border border-[#E4E3DE] bg-white p-3 text-xs font-semibold leading-5 text-[#57534E]">Suggested fix: scope permissions, require explicit approval before sensitive actions, and break unnecessary source-to-sink reachability.</p>
      <a href={objectPlaygroundHref(report, item)} className="inline-flex rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">Open in Playground →</a>
    </div>
  );
}
