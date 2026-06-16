"use client";

import type {
  RepositoryExecutionEdge,
  RepositoryExecutionNode,
  RepositoryExecutionReport,
  RepositorySensitiveAction,
} from "@promptsonar/core";
import { useEffect, useMemo, useState } from "react";
import {
  buildPlaygroundMicroscopeViewModel,
  type PathProjection,
} from "@/lib/repositoryViewModel";
import { SAMPLE_REPOSITORY_FILES } from "@/lib/repositorySample";
import { ConfidenceBadge, ProvenanceBadge, RiskBadge } from "./Badges";
import { PreviewShell } from "./PreviewShell";

type FocusParams = {
  file?: string;
  issue?: string;
  path?: string;
  action?: RepositorySensitiveAction;
};

function artifactLabel(value: string): string {
  const labels: Record<string, string> = {
    PROMPT: "Prompt",
    SKILL: "Skill",
    MCP_SERVER: "MCP configuration",
    AGENT_CONFIG: "Agent instructions",
    MEMORY: "Memory",
    TOOL: "Tool router",
    WORKFLOW: "Workflow",
    ACTION: "Sensitive action",
  };
  return labels[value] || value;
}

function sectionLabel(children: string) {
  return <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">{children}</p>;
}

function readStoredReport(scanId?: string): RepositoryExecutionReport | null {
  if (typeof window === "undefined") return null;
  const keys = scanId
    ? [`promptsonar:repository-report:${scanId}`]
    : ["promptsonar:repository-report:latest"];
  for (const key of keys) {
    try {
      const value = window.sessionStorage.getItem(key);
      if (value) return JSON.parse(value) as RepositoryExecutionReport;
    } catch {
      return null;
    }
  }
  return null;
}

function readFocusFromLocation(): { scanId?: string; focus: FocusParams } {
  const params = new URLSearchParams(window.location.search);
  return {
    scanId: params.get("scan") || params.get("scanId") || undefined,
    focus: {
      file: params.get("file") || undefined,
      issue: params.get("issue") || params.get("findingId") || undefined,
      path: params.get("path") || params.get("pathId") || undefined,
      action: (params.get("action") || undefined) as RepositorySensitiveAction | undefined,
    },
  };
}

function storeReport(report: RepositoryExecutionReport) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`promptsonar:repository-report:${report.id || "latest"}`, JSON.stringify(report));
    window.sessionStorage.setItem("promptsonar:repository-report:latest", JSON.stringify(report));
  } catch {
    // The active report still renders if browser storage is full.
  }
}

function pathHref(report: RepositoryExecutionReport, params: FocusParams): string {
  const query = new URLSearchParams();
  if (report.id) query.set("scan", report.id);
  if (params.file) query.set("file", params.file);
  if (params.issue) query.set("issue", params.issue);
  if (params.path) query.set("path", params.path);
  if (params.action) query.set("action", params.action);
  return `/playground-v4?${query.toString()}`;
}

function nodePath(node: RepositoryExecutionNode): string {
  return node.relativePath || node.filePath || node.label;
}

function edgeLabel(edge: RepositoryExecutionEdge): string {
  return `${edge.type.replaceAll("_", " ")} · ${edge.confidenceLabel || "Potential"}`;
}

function edgeRelationship(edge: RepositoryExecutionEdge): string {
  const labels: Record<string, string> = {
    REFERENCES: "references",
    INVOKES: "invokes",
    ROUTES_TO: "routes to",
    READS: "reads from",
    WRITES: "writes to",
    CAN_REACH: "declares capability",
  };
  return labels[edge.relationship || edge.type] || edge.type.replaceAll("_", " ").toLowerCase();
}

function edgeEvidence(edge: RepositoryExecutionEdge): string {
  return edge.evidence || edge.reason || "Structurally inferred relationship";
}

function evidencePreview(evidence: ReturnType<typeof buildPlaygroundMicroscopeViewModel>["evidence"][number] | undefined): string {
  if (!evidence) return "See evidence above.";
  if (evidence.kind === "direct") return evidence.snippet || "Evidence location recorded without a snippet.";
  return evidence.missingRequirement;
}

export function PlaygroundMicroscope() {
  const [report, setReport] = useState<RepositoryExecutionReport | null>(null);
  const [focus, setFocus] = useState<FocusParams>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<"upstream" | "downstream" | "all">("all");

  useEffect(() => {
    const { scanId, focus: nextFocus } = readFocusFromLocation();
    setFocus(nextFocus);
    const handlePopState = () => {
      setFocus(readFocusFromLocation().focus);
    };
    window.addEventListener("popstate", handlePopState);
    const stored = readStoredReport(scanId);
    if (stored) {
      setReport(stored);
      return () => window.removeEventListener("popstate", handlePopState);
    }
    if (scanId) {
      setLoading(true);
      fetch(`/api/repository?scanId=${encodeURIComponent(scanId)}`)
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data?.error || "Preview scan could not be loaded.");
          setReport(data.report);
          storeReport(data.report);
        })
        .catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "Preview scan could not be loaded.");
        })
        .finally(() => setLoading(false));
    }
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const view = useMemo(() => report ? buildPlaygroundMicroscopeViewModel({
    report,
    filePath: focus.file,
    issueId: focus.issue,
    pathId: focus.path,
    actionType: focus.action,
  }) : null, [focus, report]);

  const visibleGraph = useMemo(() => {
    if (!view) return { nodes: [], edges: [] };
    if (graphMode === "all" || view.graph.selectedNodeIds.length === 0) {
      return { nodes: view.graph.nodes, edges: view.graph.edges };
    }
    const keep = new Set<string>(view.graph.selectedNodeIds);
    for (const path of view.relatedPaths) {
      const selectedIndexes = path.nodes
        .map((node, index) => view.graph.selectedNodeIds.includes(node.id) ? index : -1)
        .filter((index) => index >= 0);
      for (const selectedIndex of selectedIndexes) {
        const nodes = graphMode === "upstream"
          ? path.nodes.slice(0, selectedIndex + 1)
          : path.nodes.slice(selectedIndex);
        nodes.forEach((node) => keep.add(node.id));
      }
    }
    return {
      nodes: view.graph.nodes.filter((node) => keep.has(node.id)),
      edges: view.graph.edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
    };
  }, [graphMode, view]);

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: SAMPLE_REPOSITORY_FILES,
          repositoryName: "Sample AI review repository",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Scan failed (${response.status})`);
      setReport(data.report);
      storeReport(data.report);
      const firstFile = data.report.impactedFiles?.[0]?.path;
      const firstIssue = data.report.impactedFiles?.[0]?.issueIds?.[0];
      setFocus({ file: firstFile, issue: firstIssue });
      window.history.replaceState({}, "", pathHref(data.report, { file: firstFile, issue: firstIssue }));
    } catch (sampleError) {
      setError(sampleError instanceof Error ? sampleError.message : "Sample scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function updateFocus(next: FocusParams) {
    if (!report) return;
    setFocus(next);
    window.history.pushState({}, "", pathHref(report, next));
  }

  return (
    <PreviewShell
      active="playground"
      crumb={view?.selectedFile || "Playground v4"}
      scanMode={report?.scanMode}
    >
      <main className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
        {!report && (
          <section className="mx-auto max-w-2xl rounded-[24px] border border-white/75 bg-white/68 p-8 text-center shadow-[0_22px_65px_-42px_rgba(28,25,23,0.72)] backdrop-blur-xl sm:p-12">
            {sectionLabel("Playground v4 · File microscope")}
            <h1 className="mt-4 font-playfair text-[38px] font-medium leading-tight tracking-[-0.03em]">Open a repository finding in context.</h1>
            <p className="mx-auto mt-4 max-w-xl text-[14px] leading-6 text-stone-600">
              Start from Repository Explorer v2, or load the built-in scan to inspect exact evidence, focused graph relationships, related paths, and canonical remediation.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <a href="/repository-v2" className="rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2">
                Open Repository Explorer
              </a>
              <button type="button" onClick={loadSample} disabled={loading} className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-[13px] font-semibold hover:bg-stone-50 disabled:opacity-50">
                {loading ? "Analyzing…" : "Load sample"}
              </button>
            </div>
            {loading && <p className="mt-5 font-mono text-[11px] text-stone-500">Loading scan context…</p>}
            {error && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800">{error}</p>}
          </section>
        )}

        {report && view && (
          <div className="space-y-10">
            <header>
              <a href="/repository-v2" className="font-mono text-[11px] text-stone-500 hover:text-stone-900 hover:underline">← Back to repository map</a>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {sectionLabel("Playground v4 · Single-file microscope")}
                <ProvenanceBadge provenance={view.provenance} />
              </div>
              <h1 className="mt-3 break-all font-mono text-[22px] font-medium tracking-[-0.02em] sm:text-[27px]">{view.selectedFile || "Selected repository object"}</h1>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-stone-300 bg-white/65 px-3 py-1.5 font-mono text-[10px] text-stone-600">{artifactLabel(view.artifactType)}</span>
                <RiskBadge risk={view.fileFindingSeverity} label={`Selected file finding · ${view.fileFindingSeverity}`} />
                <RiskBadge risk={view.highestRelatedPathRisk} label={`Highest related path · ${view.highestRelatedPathRisk}`} />
                <span className="rounded-full border border-stone-300 bg-white/65 px-3 py-1.5 font-mono text-[11px] text-stone-600">{view.issueCount} issue{view.issueCount === 1 ? "" : "s"}</span>
                <span className="rounded-full border border-stone-300 bg-white/65 px-3 py-1.5 font-mono text-[11px] text-stone-600">{view.relatedPathCount} file-related path{view.relatedPathCount === 1 ? "" : "s"}</span>
              </div>
            </header>

            <section className="rounded-2xl border border-white/75 bg-white/65 p-5 backdrop-blur-xl">
              {sectionLabel("File-level finding summary")}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-stone-900/10 bg-white/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500">Finding severity</p>
                  <p className="mt-2 font-playfair text-[22px] font-semibold capitalize">{view.fileFindingSeverity}</p>
                </div>
                <div className="rounded-xl border border-stone-900/10 bg-white/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500">Finding confidence</p>
                  <p className="mt-2 font-playfair text-[22px] font-semibold">{view.issue?.confidence.label || "Not attached"}</p>
                </div>
                <div className="rounded-xl border border-stone-900/10 bg-white/55 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone-500">Evidence items</p>
                  <p className="mt-2 font-playfair text-[22px] font-semibold">{view.evidenceCount.total}</p>
                </div>
              </div>
            </section>

            {view.issues.length > 0 && (
              <section>
                <div className="mb-5">
                  {sectionLabel("Issues in this file")}
                  <h2 className="mt-2 font-playfair text-[28px] font-medium tracking-tight">
                    {view.issueCount} finding{view.issueCount === 1 ? "" : "s"}, separate from {view.relatedPathCount} execution path{view.relatedPathCount === 1 ? "" : "s"}
                  </h2>
                  <p className="mt-2 max-w-3xl text-[13px] leading-6 text-stone-500">
                    Findings are rule violations attached to this file. Paths are distinct routes from an instruction source to a reachable action.
                  </p>
                </div>
                <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-white/75 bg-white/65 backdrop-blur-xl">
                  {view.issues.map((item, index) => {
                    const selected = item.id === view.issue?.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => updateFocus({ file: view.selectedFile, issue: item.id })}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                          event.preventDefault();
                          const nextIndex = event.key === "ArrowDown"
                            ? Math.min(view.issues.length - 1, index + 1)
                            : Math.max(0, index - 1);
                          const nextIssue = view.issues[nextIndex];
                          if (nextIssue) updateFocus({ file: view.selectedFile, issue: nextIssue.id });
                        }}
                        aria-current={selected ? "true" : undefined}
                        className={`grid w-full gap-4 border-l-4 border-t p-5 text-left first:border-t-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-inset md:grid-cols-[1fr_auto] md:items-center ${
                          selected ? "border-l-amber-600 border-t-stone-900/10 bg-amber-50/90" : "border-l-transparent border-t-stone-900/10 hover:bg-white/80"
                        }`}
                      >
                        <span>
                          <span className="block text-[13px] font-medium leading-5 text-stone-900">{item.issue}</span>
                          <span className="mt-1 block font-mono text-[11px] text-stone-500">
                            {item.ruleId} · {item.evidence.length} evidence item{item.evidence.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-2">
                          <RiskBadge risk={item.severity} />
                          <ConfidenceBadge confidence={item.confidence.level} />
                          <span className={`rounded-full px-2 py-1 font-mono text-[11px] font-medium ${selected ? "bg-amber-200 text-amber-950" : "text-stone-600"}`}>{selected ? "Selected finding" : "Inspect"}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {view.issue ? (
              <section className="relative overflow-hidden rounded-[22px] border border-red-300/60 bg-white/70 p-6 shadow-[0_20px_60px_-43px_rgba(28,25,23,0.7)] backdrop-blur-xl sm:p-8">
                <span className="absolute inset-y-0 left-0 w-1 bg-red-500" />
                <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">Selected file finding</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!view.previousIssue}
                      onClick={() => view.previousIssue && updateFocus({ file: view.selectedFile, issue: view.previousIssue.id })}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      ← Previous issue
                    </button>
                    <span className="font-mono text-[12px] text-stone-600">{view.issueIndex + 1} of {view.issueCount}</span>
                    <button
                      type="button"
                      disabled={!view.nextIssue}
                      onClick={() => view.nextIssue && updateFocus({ file: view.selectedFile, issue: view.nextIssue.id })}
                      className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Next issue →
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RiskBadge risk={view.issue.severity} label={`Severity · ${view.issue.severity}`} />
                  <ConfidenceBadge confidence={view.issue.confidence.level} />
                  <span className="font-mono text-[11px] text-stone-500">{view.issue.ruleId}</span>
                </div>
                <h2 className="mt-4 font-playfair text-[27px] font-medium leading-tight tracking-[-0.02em]">{view.issue.issue}</h2>
                <p className="mt-3 max-w-3xl text-[14px] leading-6 text-stone-600">{view.issue.impact}</p>
                <dl className="mt-4 grid gap-3 rounded-xl border border-amber-600/25 bg-amber-50/50 px-4 py-3 font-mono text-[12px] leading-5 text-stone-600 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-stone-500">Finding confidence</dt>
                    <dd className="font-semibold text-stone-900">{view.issue.confidence.label}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Evidence items</dt>
                    <dd className="font-semibold text-stone-900">{view.evidenceCount.total}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Highest related path</dt>
                    <dd className="font-semibold capitalize text-orange-800">{view.highestRelatedPathRisk}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Path confidence</dt>
                    <dd className="font-semibold text-stone-900">{view.relatedPaths[0]?.confidenceLabel || "No complete path"}</dd>
                  </div>
                </dl>
              </section>
            ) : (
              <section className="rounded-2xl border border-amber-300 bg-amber-50/55 p-6">
                <h2 className="font-playfair text-[23px] font-medium">No issue is attached to this focus.</h2>
                <p className="mt-2 text-[13px] leading-6 text-stone-600">The selected object may participate in an execution path without carrying a file-level finding.</p>
              </section>
            )}

            <section>
              <div className="mb-5">
                {sectionLabel("Evidence")}
                <h2 className="mt-2 font-playfair text-[28px] font-medium tracking-tight">Exact or absence evidence for the selected finding</h2>
              </div>
              {view.evidence.length > 0 ? (
                <div className="grid gap-3">
                  {view.evidence.map((evidence) => (
                    <article key={evidence.id} className="rounded-2xl border border-white/75 bg-white/68 p-5 backdrop-blur-xl">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-mono text-[12px] font-medium text-stone-700">
                          {evidence.filePath}
                          {evidence.kind === "direct" && evidence.line ? `:${evidence.line}` : ""}
                          {evidence.kind === "direct" && evidence.column ? `:${evidence.column}` : ""}
                          {evidence.kind === "absence" && evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}
                        </p>
                        <span className="font-mono text-[11px] text-stone-500">{evidence.ruleId}</span>
                      </div>
                      {evidence.kind === "direct" ? (
                        <>
                          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">Direct evidence</p>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-amber-300/60 bg-amber-50/70 p-4 font-mono text-[13px] leading-6 text-amber-950">{evidence.snippet || "Evidence location recorded without a snippet."}</pre>
                        </>
                      ) : (
                        <div className="mt-4 rounded-xl border border-stone-300 bg-white/70 p-4">
                          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">File-level absence finding</p>
                          <p className="mt-2 text-[13px] leading-6 text-stone-700">
                            <b>{evidence.scopeLabel}:</b> {evidence.filePath}
                            {evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}
                          </p>
                          <p className="mt-2 text-[13px] leading-6 text-stone-700">PromptSonar identified an agent instruction block in this range. {evidence.missingRequirement}</p>
                        </div>
                      )}
                      <div className="mt-3"><ConfidenceBadge confidence={evidence.confidence.level} /></div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-300 bg-white/55 p-6 text-[13px] text-stone-500">No renderable evidence fields were included for this selected object.</div>
              )}
            </section>

            <section className="grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-2xl border border-white/75 bg-white/65 p-6 backdrop-blur-xl">
                {sectionLabel("Why it matters")}
                <p className="mt-4 text-[14px] leading-7 text-stone-700">{view.whyItMatters || "No plain-language impact was included for this selected object."}</p>
              </div>
              <div className="rounded-2xl border border-white/75 bg-white/65 p-6 backdrop-blur-xl">
                {sectionLabel("Fix")}
                {view.fix ? (
                  <>
                    <h2 className="mt-3 font-playfair text-[24px] font-medium tracking-tight">{view.fix.quickFix}</h2>
                    <p className="mt-3 text-[13px] leading-6 text-stone-600">{view.fix.recommendedFix}</p>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-red-300 bg-red-50/65 p-4">
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-red-700">Before</span>
                        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-red-900">{evidencePreview(view.evidence[0])}</pre>
                      </div>
                      <div className="rounded-xl border border-emerald-300 bg-emerald-50/65 p-4">
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-700">Safe pattern</span>
                        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-emerald-900">{view.fix.safePattern || view.fix.recommendedFix}</pre>
                      </div>
                    </div>
                    <div className="mt-4 rounded-xl border border-stone-300 bg-white/60 p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">Verification</p>
                      <p className="mt-2 text-[13px] leading-6 text-stone-700">Apply the report&apos;s recommended constraint, then re-scan to verify the finding and related graph changed.</p>
                      <p className="mt-2 font-mono text-[11px] text-stone-500">Effort · {view.fix.effort}</p>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-[13px] text-stone-500">No canonical fix guidance was attached to this selected object.</p>
                )}
              </div>
            </section>

            <section>
              <div className="mb-5">
                {sectionLabel("Paths supported by this finding")}
                <h2 className="mt-2 font-playfair text-[28px] font-medium tracking-tight">Routes explicitly linked to the selected issue</h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-stone-500">
                  This section only shows paths whose canonical report record lists the selected issue as supporting evidence.
                </p>
              </div>
              {view.pathsSupportedByIssue[0] ? (
                <EndToEndFlow
                  path={view.pathsSupportedByIssue[0]}
                  selectedNodeIds={view.graph.selectedNodeIds}
                />
              ) : (
                <div className="rounded-2xl border border-stone-300 bg-white/55 p-6 text-[13px] leading-6 text-stone-500">
                  No execution path is explicitly linked to the selected finding in the canonical report.
                </div>
              )}
            </section>

            <section>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  {sectionLabel("Focused graph")}
                  <h2 className="mt-2 font-playfair text-[28px] font-medium tracking-tight">Relationships around this file</h2>
                  <p className="mt-2 text-[13px] text-stone-500">The graph is capped at 18 visible nodes and never expands to the full repository by default.</p>
                </div>
                <div className="flex rounded-xl border border-stone-300 bg-white/65 p-1" aria-label="Graph direction">
                  {(["upstream", "downstream", "all"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setGraphMode(mode)}
                      className={`rounded-lg px-3 py-2 font-mono text-[10px] font-medium capitalize ${graphMode === mode ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white"}`}
                    >
                      {mode === "all" ? "All related paths" : mode}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 rounded-[22px] border border-white/75 bg-white/68 p-5 shadow-[0_18px_55px_-42px_rgba(28,25,23,0.7)] backdrop-blur-xl sm:p-7">
                <GraphText
                  nodes={visibleGraph.nodes}
                  edges={visibleGraph.edges}
                  selectedNodeIds={view.graph.selectedNodeIds}
                />
                {view.graph.hiddenNodeCount > 0 && (
                  <p className="mt-5 text-center font-mono text-[10px] text-stone-500">{view.graph.hiddenNodeCount} related nodes hidden by the focused graph limit.</p>
                )}
                {visibleGraph.nodes.length === 0 && (
                  <p className="text-[13px] text-stone-500">No graph nodes match this focus and direction.</p>
                )}
              </div>
            </section>

            <section>
              <div className="mb-5">
                {sectionLabel("Independent execution paths involving this file")}
                <h2 className="mt-2 font-playfair text-[28px] font-medium tracking-tight">Other routes that include this file</h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-6 text-stone-500">
                  These paths involve the selected file, but they are not necessarily caused by the currently selected finding.
                </p>
              </div>
              {view.otherPathsInvolvingFile.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-white/75 bg-white/65 backdrop-blur-xl">
                  {view.otherPathsInvolvingFile.map((path) => {
                    const selectedIndex = path.nodes.findIndex((node) => view.graph.selectedNodeIds.includes(node.id));
                    const role = selectedIndex === 0 ? "Source" : selectedIndex === path.nodes.length - 1 ? "Sink" : selectedIndex > 0 ? "Intermediate" : "Related";
                    return (
                      <article key={path.id} className="grid gap-4 border-t border-stone-900/10 p-5 first:border-t-0 md:grid-cols-[1fr_auto] md:items-center">
                        <div>
                          <p className="font-mono text-[11px] leading-6 text-stone-700">
                            {path.source?.relativePath || path.source?.label || "Source"} → {path.sink?.label || path.action || "Sensitive action"}
                          </p>
                          <p className="mt-1 text-[11px] text-stone-500">{role} · {path.files.length} involved file{path.files.length === 1 ? "" : "s"} · {path.provenance}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <RiskBadge risk={path.risk} />
                          <ConfidenceBadge confidence={path.confidence} />
                          <button type="button" onClick={() => updateFocus({ ...focus, path: path.id })} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold hover:bg-stone-50">Inspect</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-300 bg-white/55 p-6 text-[13px] text-stone-500">No other complete execution paths involve this file.</div>
              )}
            </section>

          </div>
        )}
      </main>
    </PreviewShell>
  );
}

function EndToEndFlow({
  path,
  selectedNodeIds,
}: {
  path: PathProjection;
  selectedNodeIds: string[];
}) {
  const source = path.source || path.nodes[0];

  return (
    <article className="overflow-hidden rounded-[22px] border border-white/75 bg-white/68 shadow-[0_18px_55px_-42px_rgba(28,25,23,0.7)] backdrop-blur-xl">
      <div className="border-b border-stone-900/10 px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge risk={path.risk} />
          <ConfidenceBadge confidence={path.confidence} />
          <span className="rounded-full border border-stone-300 bg-white px-3 py-1 font-mono text-[9px] text-stone-500">
            {path.nodes.length} steps
          </span>
        </div>
        <p className="mt-4 font-mono text-[12px] leading-6 text-stone-800">
          {source ? nodePath(source) : "Instruction source"} → {path.sink?.label || path.action || "Sensitive action"}
        </p>
        {path.explanation && <p className="mt-2 max-w-3xl text-[12px] leading-6 text-stone-500">{path.explanation}</p>}
      </div>

      <ol aria-label="End-to-end execution steps" className="px-5 py-6 sm:px-7">
        {path.nodes.map((node, index) => {
          const incomingEdge = index > 0 ? path.edges[index - 1] : undefined;
          const selected = selectedNodeIds.includes(node.id);
          const role = index === 0 ? "Instruction source" : node.type === "ACTION" ? "Reachable action" : "Execution hop";
          return (
            <li key={node.id}>
              {incomingEdge && (
                <div className="ml-5 border-l border-dashed border-stone-300 py-3 pl-6">
                  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone-500">
                    Relationship: {edgeRelationship(incomingEdge)} · Confidence: {incomingEdge.confidenceLabel || "Potential"}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-stone-500">Evidence: {edgeEvidence(incomingEdge)}</p>
                  {incomingEdge.evidenceRefs?.[0] && <p className="mt-1 font-mono text-[11px] text-stone-400">Rule: {incomingEdge.evidenceRefs[0]}</p>}
                </div>
              )}
              <div className={`rounded-2xl border p-4 sm:grid sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4 ${
                selected
                  ? "border-amber-500 bg-amber-50"
                  : node.type === "ACTION"
                    ? "border-red-300 bg-red-50/70"
                    : "border-stone-300 bg-white/75"
              }`}>
                <span className="font-mono text-[10px] text-stone-400">{String(index + 1).padStart(2, "0")}</span>
                <div className="mt-2 min-w-0 sm:mt-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-500">{role} · {artifactLabel(node.type)}</p>
                  <p className="mt-1 break-all font-mono text-[12px] font-medium text-stone-900">{nodePath(node)}</p>
                </div>
                {selected && <span className="mt-3 inline-flex rounded-full bg-amber-200 px-2.5 py-1 font-mono text-[9px] font-medium text-amber-950 sm:mt-0">Selected file</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function GraphText({
  nodes,
  edges,
  selectedNodeIds,
}: {
  nodes: RepositoryExecutionNode[];
  edges: RepositoryExecutionEdge[];
  selectedNodeIds: string[];
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connected = edges
    .map((edge) => ({
      edge,
      from: nodeById.get(edge.from),
      to: nodeById.get(edge.to),
    }))
    .filter((item): item is { edge: RepositoryExecutionEdge; from: RepositoryExecutionNode; to: RepositoryExecutionNode } => Boolean(item.from && item.to));

  return (
    <div role="list" aria-label="Textual focused execution graph" className="space-y-3">
      {connected.map(({ edge, from, to }) => (
        <div key={edge.id} role="listitem" className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <div className={`rounded-xl border px-4 py-3 ${selectedNodeIds.includes(from.id) ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-white/75"}`}>
            <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">{artifactLabel(from.type)}</span>
            <span className="mt-1 block break-all font-mono text-[11px] font-medium">{nodePath(from)}</span>
          </div>
          <div className="px-2 text-center">
            <details className="group">
              <summary className="cursor-pointer list-none rounded-lg px-2 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">
                <span className="block text-stone-300" aria-hidden="true">→</span>
                <span className="block max-w-40 font-mono text-[11px] uppercase tracking-[0.05em] text-stone-500">{edgeLabel(edge)}</span>
              </summary>
              <dl className="mt-2 rounded-xl border border-stone-300 bg-white/90 p-3 text-left text-[12px] leading-5 text-stone-600 shadow-sm">
                <div><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone-400">Relationship</dt><dd>{edgeRelationship(edge)}</dd></div>
                <div className="mt-2"><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone-400">Confidence</dt><dd>{edge.confidenceLabel || "Potential"}</dd></div>
                <div className="mt-2"><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone-400">Evidence</dt><dd>{edgeEvidence(edge)}</dd></div>
                {edge.evidenceRefs?.[0] && <div className="mt-2"><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone-400">Rule</dt><dd className="break-all font-mono">{edge.evidenceRefs[0]}</dd></div>}
              </dl>
            </details>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${selectedNodeIds.includes(to.id) ? "border-amber-500 bg-amber-50" : to.type === "ACTION" ? "border-red-300 bg-red-50/70" : "border-stone-300 bg-white/75"}`}>
            <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">{artifactLabel(to.type)}</span>
            <span className="mt-1 block break-all font-mono text-[11px] font-medium">{nodePath(to)}</span>
          </div>
        </div>
      ))}
      {connected.length === 0 && nodes.map((node) => (
        <div key={node.id} className={`rounded-xl border px-4 py-3 ${selectedNodeIds.includes(node.id) ? "border-amber-500 bg-amber-50" : "border-stone-300 bg-white/75"}`}>
          <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">{artifactLabel(node.type)}</span>
          <span className="mt-1 block break-all font-mono text-[11px] font-medium">{nodePath(node)}</span>
        </div>
      ))}
    </div>
  );
}
