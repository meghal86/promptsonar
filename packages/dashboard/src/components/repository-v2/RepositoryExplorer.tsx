"use client";

import type {
  RepositoryExecutionReport,
  RepositoryPathConfidence,
  RepositoryRisk,
} from "@promptsonar/core";
import { useEffect, useMemo, useState } from "react";
import { buildRepositoryExplorerViewModel } from "@/lib/repositoryViewModel";
import {
  SAMPLE_REPOSITORY_FILES,
  type RepositoryPayloadFile,
} from "@/lib/repositorySample";
import {
  MAX_BROWSER_FILE_CHARS,
  MAX_BROWSER_FILES,
  MAX_BROWSER_TOTAL_CHARS,
  buildRepositoryPayload,
  prepareRepositorySelection,
  repositoryFileDisplayName,
} from "@/lib/repositorySelection";
import { saveRepositoryFiles } from "@/lib/repositoryFileStore";
import { findingLane, LANE_LABEL, type FindingLane } from "@/lib/plainLanguage";
import { ConfidenceBadge, ProvenanceBadge, RiskBadge } from "./Badges";
import { PreviewShell } from "./PreviewShell";
import { ExecutionFlowGraph } from "./ExecutionFlowGraph";
import { CodeDiff } from "../repository/CodeDiff";
import { BusinessImpact } from "../repository/BusinessImpact";

type ScanMeta = {
  filesReceived: number;
  filesWritten: number;
  filesSkipped: number;
  mode: string;
  cli: string;
  timings?: {
    scannerMs: number;
    reportMs: number;
    totalMs: number;
  };
};

function sectionLabel(children: string) {
  return <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500">{children}</p>;
}

function SectionHeading({ label, title, help }: { label: string; title: string; help?: string }) {
  return (
    <header className="mb-5">
      {sectionLabel(label)}
      <h2 className="mt-2 font-sans text-[27px] font-medium leading-tight tracking-[-0.02em] text-stone-900 sm:text-[31px]">{title}</h2>
      {help && <p className="mt-2 max-w-2xl text-[14px] leading-6 text-stone-600">{help}</p>}
    </header>
  );
}

function actionLabel(value?: string): string {
  const labels: Record<string, string> = {
    Filesystem: "the filesystem",
    Shell: "shell execution",
    Network: "network access",
    Secrets: "secret access",
    "External APIs": "external APIs",
  };
  return value ? labels[value] || value.toLowerCase() : "a sensitive action";
}

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

function saveReport(report: RepositoryExecutionReport) {
  if (typeof window === "undefined") return;
  try {
    const key = `promptsonar:repository-report:${report.id || "latest"}`;
    window.sessionStorage.setItem(key, JSON.stringify(report));
    window.sessionStorage.setItem("promptsonar:repository-report:latest", JSON.stringify(report));
  } catch {
    // Large reports can exceed browser storage. The current page remains usable.
  }
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

function microscopeHref(report: RepositoryExecutionReport, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  if (report.id) query.set("scan", report.id);
  // Opened from a repository scan, so the microscope must run in repository mode
  // (real execution-path context) — not single-input/standalone mode.
  query.set("mode", "repository");
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return `/playground-v4?${query.toString()}`;
}

function repositorySectionHref(report: RepositoryExecutionReport | null, section: string): string {
  const query = new URLSearchParams();
  if (report?.id) query.set("scan", report.id);
  query.set("section", section);
  return `/repository-v2?${query.toString()}#${section}`;
}

function downloadBlob(name: string, value: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

// Real, client-side Markdown export generated from the canonical report — no
// fabricated content. The GitHub-comment variant is the same Markdown trimmed
// to the highest-severity findings so it fits a PR comment.
function buildMarkdownReport(report: RepositoryExecutionReport, limit = Infinity): string {
  const summary = report.summary;
  const lines: string[] = [];
  lines.push(`# PromptSonar repository report — ${report.repository?.name || "repository"}`);
  lines.push("");
  lines.push(`- **Overall risk:** ${summary?.overallRisk || "none"}`);
  lines.push(`- **Trust status:** ${summary?.trustStatus || "—"}`);
  lines.push(`- **Reachable paths:** ${report.reachablePaths?.length ?? 0}`);
  lines.push(`- **Findings:** ${report.issues?.length ?? 0}`);
  const actions = summary?.reachableSensitiveActions || {};
  const reachable = Object.entries(actions).filter(([, count]) => Number(count) > 0);
  if (reachable.length > 0) {
    lines.push(`- **Reachable sensitive actions:** ${reachable.map(([name, count]) => `${name} (${count})`).join(", ")}`);
  }
  lines.push("");
  const issues = [...(report.issues || [])]
    .sort((a, b) => SEVERITY_RANK(b.severity) - SEVERITY_RANK(a.severity))
    .slice(0, limit);
  if (issues.length > 0) {
    lines.push(limit === Infinity ? "## Findings" : `## Top ${issues.length} findings`);
    lines.push("");
    for (const issue of issues) {
      lines.push(`### ${String(issue.severity || "finding").toUpperCase()} · ${issue.issue || issue.ruleId}`);
      if (issue.howToFix || issue.fix?.recommendedFix) lines.push(`**Fix:** ${issue.fix?.recommendedFix || issue.howToFix}`);
      const files = issue.impactedFiles || [];
      if (files.length > 0) lines.push(`**Files:** ${files.slice(0, 6).map((file) => `\`${file}\``).join(", ")}`);
      lines.push(`*Rule: ${issue.ruleId} · confidence: ${issue.confidence?.level || "—"}*`);
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("*Generated by PromptSonar. Run `npx @promptsonar/cli repo .` for the full local scan.*");
  return lines.join("\n");
}

function SEVERITY_RANK(severity?: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity || ""] ?? 0;
}

function Disclosure({
  id,
  title,
  description,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_50px_-35px_rgba(28,25,23,0.5)] backdrop-blur-xl">
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-5 px-5 py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-800 focus-visible:ring-inset sm:px-7"
        aria-controls={id}
      >
        <span>
          <span className="block font-sans text-[20px] font-medium tracking-tight text-stone-900">{title}</span>
          <span className="mt-1 block text-[13px] leading-5 text-stone-500">{description}</span>
        </span>
        <span className="font-mono text-[16px] text-stone-400 transition group-open:rotate-45" aria-hidden="true">+</span>
      </summary>
      <div id={id} className="border-t border-stone-900/10 px-5 py-6 sm:px-7">{children}</div>
    </details>
  );
}

// Plain-language "what this is / why it helps" intro for a section, so any
// reader — engineer, security, or PM — understands it without prior vocabulary.
function WhatWhy({ what, why }: { what: string; why: string }) {
  return (
    <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50/70 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-500">What this is</p>
      <p className="mt-2 text-[13px] leading-6 text-stone-600">{what}</p>
      <p className="mt-2 text-[13px] leading-6 text-stone-600"><span className="font-semibold text-stone-700">Why it helps:</span> {why}</p>
    </div>
  );
}

export function RepositoryExplorer() {
  const [files, setFiles] = useState<File[]>([]);
  const [selectionStats, setSelectionStats] = useState({
    total: 0,
    eligible: 0,
    queued: 0,
    excludedByFileLimit: 0,
    excludedByPayloadLimit: 0,
    estimatedChars: 0,
  });
  const [report, setReport] = useState<RepositoryExecutionReport | null>(null);
  const [scanMeta, setScanMeta] = useState<ScanMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedComment, setCopiedComment] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [pathFilters, setPathFilters] = useState({
    file: "",
    action: "",
    severity: "",
    confidence: "",
    provenance: "",
    artifactType: "",
  });
  const [fileFilters, setFileFilters] = useState({
    query: "",
    severity: "",
    provenance: "",
    artifactType: "",
  });
  const [pathLimit, setPathLimit] = useState(20);
  const [fileLimit, setFileLimit] = useState(20);
  // Security / Reliability / Quality filter for the remediation list (all on by default).
  const [remediationLanes, setRemediationLanes] = useState<Set<FindingLane>>(() => new Set<FindingLane>(["security", "reliability", "quality"]));
  const toggleRemediationLane = (lane: FindingLane) => setRemediationLanes((current) => {
    const next = new Set(current);
    if (next.has(lane)) next.delete(lane); else next.add(lane);
    return next.size === 0 ? new Set<FindingLane>(["security", "reliability", "quality"]) : next;
  });

  const view = useMemo(
    () => report ? buildRepositoryExplorerViewModel(report) : null,
    [report],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scanId = params.get("scan") || params.get("scanId") || undefined;
    const section = params.get("section") || undefined;
    const scrollToSection = () => {
      if (section) window.setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: "start" }), 250);
    };
    const stored = readStoredReport(scanId);
    if (stored) {
      setReport(stored);
      if (!scanId && stored.id) {
        window.history.replaceState({}, "", `/repository-v2?scan=${encodeURIComponent(stored.id)}&section=${section || "overview"}#${section || "overview"}`);
      }
      scrollToSection();
      return;
    }
    if (!scanId) return;
    setLoading(true);
    fetch(`/api/repository?scanId=${encodeURIComponent(scanId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "Repository scan could not be loaded.");
        setReport(data.report);
        saveReport(data.report);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Repository scan could not be loaded.");
      })
      .finally(() => setLoading(false));
    scrollToSection();
  }, []);

  useEffect(() => {
    if (!report) return;
    const sectionIds = [
      "overview",
      "highest-risk-path",
      "files",
      "remediation",
      "paths",
      "evidence",
      "exports",
    ];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActiveSection(visible.target.id);
    }, { rootMargin: "-20% 0px -70% 0px", threshold: [0.1, 0.25, 0.5] });
    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [report]);

  const filteredPaths = useMemo(() => {
    if (!view) return [];
    return view.paths.filter((path) => {
      const text = `${path.files.join(" ")} ${path.nodes.map((node) => node.type).join(" ")}`.toLowerCase();
      return (
        (!pathFilters.file || text.includes(pathFilters.file.toLowerCase())) &&
        (!pathFilters.action || path.action === pathFilters.action) &&
        (!pathFilters.severity || path.risk === pathFilters.severity) &&
        (!pathFilters.confidence || path.confidence === pathFilters.confidence) &&
        (!pathFilters.provenance || path.provenance === pathFilters.provenance) &&
        (!pathFilters.artifactType || path.nodes.some((node) => node.type === pathFilters.artifactType))
      );
    });
  }, [pathFilters, view]);

  const filteredFiles = useMemo(() => {
    if (!view) return [];
    return view.files.filter((file) => {
      const text = `${file.path} ${file.label} ${file.name}`.toLowerCase();
      return (
        (!fileFilters.query || text.includes(fileFilters.query.toLowerCase())) &&
        (!fileFilters.severity || file.fileFindingSeverity === fileFilters.severity || file.highestPathRisk === fileFilters.severity) &&
        (!fileFilters.provenance || file.provenance === fileFilters.provenance) &&
        (!fileFilters.artifactType || file.artifactType === fileFilters.artifactType)
      );
    });
  }, [fileFilters, view]);

  function handleFiles(selected: FileList | null) {
    const allFiles = Array.from(selected || []);
    const nextSelection = prepareRepositorySelection(allFiles);
    setFiles(nextSelection.files);
    setSelectionStats(nextSelection.stats);
    setReport(null);
    setError(null);
  }

  async function scanPayload(payloadFiles: RepositoryPayloadFile[], repositoryName: string) {
    const controller = new AbortController();
    const hardTimeout = window.setTimeout(() => controller.abort(), 120_000);

    // Cycle through scan phases so the user sees progress, not a frozen spinner.
    const PHASES: Array<{ label: string; afterMs: number }> = [
      { label: `Indexing ${payloadFiles.length} files and detecting artifact types…`, afterMs: 0 },
      { label: "Extracting prompts, skills, and tool configurations…", afterMs: 5_000 },
      { label: "Tracing execution routes through tool routers and MCP servers…", afterMs: 15_000 },
      { label: "Confirming path reachability and scoring risks…", afterMs: 35_000 },
      { label: "Finalising execution map — almost done…", afterMs: 65_000 },
    ];
    const phaseTimers: number[] = [];
    for (const phase of PHASES) {
      phaseTimers.push(window.setTimeout(() => setScanProgress(phase.label), phase.afterMs));
    }

    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payloadFiles, repositoryName }),
        signal: controller.signal,
      });
      setScanProgress("Building the execution map and repository report…");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Scan failed (${response.status})`);
      setReport(data.report);
      setScanMeta(data.scan);
      saveReport(data.report);
      // Persist the scanned file text so the file microscope can show full-file
      // before/after context (browser session only, never re-uploaded).
      saveRepositoryFiles(data.report?.id, payloadFiles);
      if (data.report?.id) {
        window.history.replaceState({}, "", `/repository-v2?scan=${encodeURIComponent(data.report.id)}&section=overview#overview`);
      }
    } catch (scanError) {
      if (scanError instanceof DOMException && scanError.name === "AbortError") {
        throw new Error("The dashboard scan service did not finish within 120 seconds. Retry once, or use the local CLI for a complete repository scan: npx @promptsonar/cli repo .");
      }
      throw scanError;
    } finally {
      window.clearTimeout(hardTimeout);
      for (const t of phaseTimers) window.clearTimeout(t);
    }
  }

  async function scanSelectedFiles() {
    if (!files.length) {
      setError("Choose a repository folder or run the built-in sample.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setScanProgress(`Reading 0 of ${files.length.toLocaleString()} bounded files…`);
      const payload = await buildRepositoryPayload(files, (completed, total) => {
        if (completed === total || completed % 10 === 0) {
          setScanProgress(`Reading ${completed.toLocaleString()} of ${total.toLocaleString()} bounded files…`);
        }
      });
      await scanPayload(payload.files, repositoryFileDisplayName(files[0]).split("/")[0] || "Uploaded repository");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Repository scan failed.");
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }

  async function scanSample() {
    setLoading(true);
    setError(null);
    try {
      await scanPayload(SAMPLE_REPOSITORY_FILES, "Sample AI review repository");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Sample scan failed.");
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }

  async function exportReport(format: "json" | "sarif" | "html" | "mapJson" | "markdown" | "githubComment") {
    if (!report) return;
    if (format === "json") {
      downloadBlob("promptsonar-repository-report.json", JSON.stringify(report, null, 2), "application/json");
      return;
    }
    if (format === "mapJson") {
      downloadBlob("promptsonar-execution-map.json", JSON.stringify(report.executionMap, null, 2), "application/json");
      return;
    }
    if (format === "markdown") {
      downloadBlob("promptsonar-repository-report.md", buildMarkdownReport(report), "text/markdown");
      return;
    }
    if (format === "githubComment") {
      await navigator.clipboard.writeText(buildMarkdownReport(report, 5));
      setCopiedComment(true);
      window.setTimeout(() => setCopiedComment(false), 1800);
      return;
    }
    const response = await fetch("/api/repository/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, report }),
    });
    if (!response.ok) {
      setError("The report export could not be generated.");
      return;
    }
    const value = await response.text();
    downloadBlob(
      format === "sarif" ? "promptsonar-repository.sarif.json" : "promptsonar-repository.html",
      value,
      format === "sarif" ? "application/sarif+json" : "text/html",
    );
  }

  async function copyCliCommand() {
    await navigator.clipboard.writeText("npx @promptsonar/cli repo .");
    setCopiedCommand(true);
    window.setTimeout(() => setCopiedCommand(false), 1800);
  }

  const path = view?.highestRiskPath;
  const pathVerb = path?.confidence === "confirmed" ? "can" : "may";

  return (
    <PreviewShell
      active="repository"
      crumb={view?.repositoryName || "Repository Explorer v2"}
      scanMode={report?.scanMode}
    >
      <main className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
        {!report && (
          <>
            <header className="max-w-3xl">
              {sectionLabel("Repository Explorer v2")}
              <h1 className="mt-4 max-w-[760px] font-sans text-[40px] font-medium leading-[1.03] tracking-[-0.035em] text-stone-900 sm:text-[58px]">
                See where AI instructions <span className="italic text-amber-700">can go.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-[16px] leading-7 text-stone-600">
                Trace prompts, skills, workflows, tool routers, MCP servers, and memory systems to the sensitive actions they can reach.
              </p>
            </header>

            <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <button
                type="button"
                onClick={scanSample}
                disabled={loading}
                className="rounded-2xl border border-amber-600/30 bg-[linear-gradient(180deg,rgba(255,249,230,0.9),rgba(255,255,255,0.72))] p-7 text-left shadow-[0_18px_55px_-38px_rgba(28,25,23,0.7)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-amber-700/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-700">Built-in demo</span>
                <span className="mt-3 block font-sans text-[24px] font-medium tracking-tight">Run the sample repository</span>
                <span className="mt-2 block text-[14px] leading-6 text-stone-600">A deterministic fixture with prompts, a skill, workflow, router, memory, and MCP configuration.</span>
                <span className="mt-5 block font-mono text-[12px] font-medium text-stone-900">{loading ? "Analyzing…" : "Analyze sample →"}</span>
                <span className="mt-3 block text-[11px] text-stone-500">Processed by this dashboard service · no LLM calls</span>
              </button>

              <label className="cursor-pointer rounded-2xl border border-white/75 bg-white/65 p-7 shadow-[0_18px_55px_-38px_rgba(28,25,23,0.7)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-stone-400 focus-within:ring-2 focus-within:ring-stone-900">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-700">Folder upload</span>
                <span className="mt-3 block font-sans text-[24px] font-medium tracking-tight">
                  {selectionStats.total
                    ? `${selectionStats.total.toLocaleString()} files selected`
                    : "Select repository folder"}
                </span>
                <span className="mt-2 block text-[14px] leading-6 text-stone-600">
                    {selectionStats.total
                    ? `${selectionStats.queued.toLocaleString()} prioritized files fit the browser scan limits.`
                    : "Selected eligible text files are sent to this dashboard service for a bounded deterministic scan."}
                </span>
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => handleFiles(event.target.files)}
                  {...({ webkitdirectory: "true", directory: "true" } as React.InputHTMLAttributes<HTMLInputElement>)}
                />
                <span className="mt-5 block font-mono text-[12px] font-medium text-stone-900">Choose folder →</span>
                <span className="mt-3 block text-[11px] text-stone-500">For fully local analysis with no uploads, use the CLI shown below.</span>
              </label>

              <div
                aria-disabled="true"
                aria-describedby="github-coming-soon"
                className="rounded-2xl border border-white/75 bg-white/45 p-7 opacity-80 shadow-[0_18px_55px_-38px_rgba(28,25,23,0.55)] backdrop-blur-xl"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-700">GitHub repository</span>
                  <span className="rounded-full border border-stone-300 bg-white/70 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone-600">Coming soon</span>
                </div>
                <span className="mt-3 block font-sans text-[24px] font-medium tracking-tight">Scan from a GitHub URL</span>
                <span id="github-coming-soon" className="mt-2 block text-[14px] leading-6 text-stone-600">Connect a repository without selecting a local folder. This option is disabled until GitHub import is implemented.</span>
                <div role="textbox" aria-disabled="true" className="mt-5 rounded-xl border border-stone-300 bg-white/55 px-3 py-3 font-mono text-[11px] text-stone-400">
                  https://github.com/your-org/your-repo
                </div>
                <span className="mt-3 block text-[11px] text-stone-500">Repository processing will use the configured scan service.</span>
              </div>
            </section>

            {selectionStats.total > 0 && (
              <div className="mt-4 flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/75 bg-white/65 p-5 backdrop-blur-xl sm:flex-row sm:items-center">
                <div>
                  <p className="text-[14px] font-medium">
                    {selectionStats.queued.toLocaleString()} of {selectionStats.total.toLocaleString()} selected files are ready to scan
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-stone-500">
                    {Math.max(0, selectionStats.total - selectionStats.eligible).toLocaleString()} unsupported or ignored files excluded
                    {selectionStats.excludedByFileLimit > 0
                      ? ` · ${selectionStats.excludedByFileLimit.toLocaleString()} eligible files exceed the ${MAX_BROWSER_FILES.toLocaleString()}-file browser limit`
                      : ""}
                    {selectionStats.excludedByPayloadLimit > 0
                      ? ` · ${selectionStats.excludedByPayloadLimit.toLocaleString()} candidates exceed the ${Math.round(MAX_BROWSER_TOTAL_CHARS / 1_000).toLocaleString()} KB total-content limit`
                      : ""}
                    {` · ${MAX_BROWSER_FILE_CHARS.toLocaleString()} characters maximum per queued file`}
                  </p>
                  <p className="mt-2 font-mono text-[10px] text-stone-400">
                    AI-relevant configuration, prompts, skills, workflows, routers, and memory files are prioritized.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={scanSelectedFiles}
                  disabled={loading || files.length === 0}
                  className="rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {loading ? "Scanning…" : files.length ? "Scan repository" : "No eligible files"}
                </button>
              </div>
            )}

            {loading && (
              <div className="mt-6 space-y-3" aria-live="polite" aria-busy="true">
                <p className="font-mono text-[11px] text-stone-600">{scanProgress || "Preparing bounded scan…"}</p>
                <div className="ps-skeleton h-24 w-full rounded-2xl" />
                <div className="ps-skeleton h-44 w-full rounded-2xl" />
              </div>
            )}

            {error && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800">{error}</p>}

            <div className="mt-8 flex flex-col gap-3 border-t border-stone-900/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-medium text-stone-900">Full local repository analysis</p>
                <p className="mt-1 text-[12px] text-stone-500">Runs locally with no uploads and no LLM calls.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-xl bg-stone-900 px-4 py-3 font-mono text-[12px] text-stone-100">npx @promptsonar/cli repo .</code>
                <button type="button" onClick={copyCliCommand} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">
                  {copiedCommand ? "Copied" : "Copy command"}
                </button>
              </div>
            </div>
          </>
        )}

        {report && view && (
          <div className="space-y-12">
            <nav className="sticky top-16 z-10 -mx-2 overflow-x-auto border-y border-stone-900/10 bg-[#f7f5f1]/82 px-2 py-2 backdrop-blur-xl" aria-label="Repository report sections">
              <div className="flex min-w-max gap-2">
                {[
                  ["overview", "Overview"],
                  ["highest-risk-path", "Highest-risk path"],
                  ["files", "Files"],
                  ["remediation", "Remediation"],
                  ["paths", "Paths"],
                  ["evidence", "Evidence"],
                  ["exports", "Exports"],
                ].map(([id, label]) => (
                  <a
                    key={id}
                    href={repositorySectionHref(report, id)}
                    aria-current={activeSection === id ? "location" : undefined}
                    className={`rounded-full px-3 py-2 font-mono text-[11px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 ${
                      activeSection === id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white/70 hover:text-stone-900"
                    }`}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </nav>

            <section id="overview" aria-labelledby="repository-verdict" className="scroll-mt-32">
              {sectionLabel("01 · Repository verdict")}
              <div className="relative mt-3 overflow-hidden rounded-[24px] border border-white/75 bg-white/68 p-6 shadow-[0_22px_65px_-42px_rgba(28,25,23,0.72)] backdrop-blur-xl sm:p-9">
                <div className={`absolute inset-y-0 left-0 w-1.5 ${view.overallRisk === "critical" ? "bg-red-800" : view.overallRisk === "high" ? "bg-red-500" : view.overallRisk === "medium" ? "bg-amber-500" : "bg-emerald-600"}`} />
                <div className="flex flex-wrap gap-3">
                  <div className="rounded-xl border border-stone-900/10 bg-white/60 px-4 py-3">
                    <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400">Overall risk</span>
                    <span className="mt-1 block font-sans text-[23px] font-semibold capitalize">{view.overallRisk === "none" ? "None found" : view.overallRisk}</span>
                  </div>
                  <div className="rounded-xl border border-stone-900/10 bg-white/60 px-4 py-3">
                    <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-stone-400">Trust status</span>
                    <span className="mt-1 block font-sans text-[21px] font-semibold">{view.trustStatus}</span>
                  </div>
                </div>

                <h1 id="repository-verdict" className="mt-6 max-w-3xl font-sans text-[29px] font-medium leading-[1.12] tracking-[-0.025em] sm:text-[39px]">
                  {path
                    ? `A ${path.risk}-risk path ${pathVerb} reach ${actionLabel(path.action)}.`
                    : "No production-relevant sensitive-action paths were found."}
                </h1>
                <p className="mt-3 max-w-3xl text-[14px] leading-6 text-stone-600">
                  {path?.explanation || (
                    `PromptSonar scanned ${view.productionArtifactCount.toLocaleString()} production-relevant AI artifact${view.productionArtifactCount === 1 ? "" : "s"}. ${view.nonProduction.total.toLocaleString()} non-production suggestion${view.nonProduction.total === 1 ? "" : "s"} are available. This result is limited to the artifacts and relationships PromptSonar scanned; it is not a universal safety guarantee.`
                  )}
                </p>

                {path && (
                  <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-amber-600/25 bg-amber-50/45 px-4 py-3">
                    <span className="font-mono text-[11px] text-stone-500">Highest path confidence</span>
                    <ConfidenceBadge confidence={path.confidence} />
                    <span className="text-[12px] text-stone-500">The weakest required edge governs the full path.</span>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">Production findings by evidence</span>
                  {(["confirmed", "probable", "potential"] as RepositoryPathConfidence[]).map((confidence) => (
                    <div key={confidence} className="flex items-baseline gap-2 rounded-xl border border-stone-900/10 bg-white/55 px-3 py-2">
                      <span className="font-sans text-[20px] font-semibold">{view.findingConfidence[confidence]}</span>
                      <span className="font-mono text-[10px] capitalize text-stone-500">{confidence}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 border-t border-stone-900/10 pt-5">
                  <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] text-stone-600">
                    <span><b className="text-stone-900">{view.coverage.filesConsidered}</b> considered</span>
                    <span><b className="text-stone-900">{view.coverage.filesScanned}</b> scanned</span>
                    <span><b className="text-stone-900">{view.coverage.filesSkipped}</b> skipped</span>
                    <span><b className="text-stone-900">{view.productionArtifactCount}</b> production-relevant AI artifacts</span>
                    {view.coverage.partial && <span className="font-semibold text-amber-800">Partial scan</span>}
                  </div>
                  {Object.keys(view.coverage.skipReasons).length > 0 && (
                    <p className="mt-3 text-[12px] text-stone-500">
                      Skipped: {Object.entries(view.coverage.skipReasons).map(([reason, count]) => `${reason} ${count}`).join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                {sectionLabel("Execution flow — sources to sensitive actions")}
                <div className="mt-3">
                  <ExecutionFlowGraph paths={view.paths} scanId={report.id} />
                </div>
              </div>
            </section>

            {view.businessImpact.length > 0 && (
              <section aria-labelledby="business-impact">
                {sectionLabel("What this means for the business")}
                <h2 id="business-impact" className="sr-only">Business impact</h2>
                <div className="mt-3">
                  <BusinessImpact items={view.businessImpact} />
                </div>
              </section>
            )}

            {view.nextAction && (
              <section aria-labelledby="next-action">
                {sectionLabel("02 · Your next action")}
                <div className="relative mt-3 overflow-hidden rounded-2xl border border-amber-600/30 bg-[linear-gradient(180deg,rgba(255,249,230,0.88),rgba(255,255,255,0.7))] p-6 shadow-[0_18px_55px_-40px_rgba(28,25,23,0.8)] sm:p-7">
                  <span className="absolute inset-y-0 left-0 w-1 bg-amber-600" />
                  <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-700">Fix first</p>
                      <h2 id="next-action" className="mt-2 font-sans text-[25px] font-medium tracking-tight">
                        <span className="font-mono text-[17px]">{view.nextAction.file}</span>
                      </h2>
                      <p className="mt-2 text-[13px] leading-6 text-stone-600"><b className="text-stone-900">Reason:</b> {view.nextAction.reason}</p>
                      <p className="mt-1 text-[13px] leading-6 text-stone-600"><b className="text-stone-900">Expected effect:</b> Apply the report&apos;s recommended constraint, then re-scan to verify the updated graph.</p>
                      <p className="mt-3 font-mono text-[11px] text-stone-500">Effort · {view.nextAction.effort}</p>
                    </div>
                    <a
                      href={microscopeHref(report, {
                        artifact: view.files.find((file) => file.path === view.nextAction?.file)?.artifactId,
                        file: view.nextAction.file,
                        issue: view.nextAction.issueId,
                      })}
                      className="shrink-0 rounded-xl bg-stone-900 px-5 py-3 text-center text-[13px] font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
                    >
                      Inspect this file
                    </a>
                  </div>
                  {view.nextAction.before && view.nextAction.after && (
                    <CodeDiff
                      className="mt-5"
                      before={view.nextAction.before}
                      after={view.nextAction.after}
                      beforeLabel="Before — current code"
                      afterLabel="After — safe pattern"
                    />
                  )}
                </div>
              </section>
            )}

            {path && (
              <section id="highest-risk-path" className="scroll-mt-32">
                <SectionHeading
                  label="03 · Highest-risk path"
                  title="The route that needs attention first"
                  help="Every node and edge below comes from the canonical repository execution map."
                />
                <div className="grid gap-8 rounded-[24px] border border-white/75 bg-white/68 p-6 shadow-[0_20px_60px_-43px_rgba(28,25,23,0.7)] backdrop-blur-xl md:grid-cols-[0.92fr_1.08fr] sm:p-8">
                  <div className="flex flex-col items-stretch">
                    {path.nodes.map((node, index) => {
                      const edge = index > 0 ? path.edges[index - 1] : undefined;
                      return (
                        <div key={node.id}>
                          {edge && (
                            <div className="flex h-12 items-center justify-center gap-3">
                              <span className="h-full w-px bg-stone-300" aria-hidden="true" />
                              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone-500">
                                {edge.type.replaceAll("_", " ")} · {edge.confidenceLabel || "Potential"}
                                {edge.evidenceRefs?.length ? ` · ${edge.evidenceRefs.length} evidence` : ""}
                              </span>
                            </div>
                          )}
                          <div className={`rounded-xl border px-4 py-3 text-center ${node.type === "ACTION" ? "border-red-300 bg-red-50/75" : "border-stone-300 bg-white/80"}`}>
                            <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-stone-400">{artifactLabel(node.type)}</span>
                            <span className={`mt-1 block font-mono text-[13px] font-medium ${node.type === "ACTION" ? "text-red-800" : "text-stone-900"}`}>{node.relativePath || node.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    {sectionLabel("What this means")}
                    <h3 className="mt-3 font-sans text-[24px] font-medium leading-tight tracking-tight">{path.explanation}</h3>
                    {view.selectedPathImpacts.length > 0 && (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {view.selectedPathImpacts.map((impact) => (
                          <div key={impact.action} className="rounded-2xl border border-red-300/55 bg-red-50/55 p-5">
                            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-red-700">{impact.action}</p>
                            <p className="mt-2 text-[15px] font-medium leading-6 text-stone-900">{impact.statement}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <dl className="mt-6 space-y-4 text-[13px] leading-6">
                      <div className="grid gap-1 sm:grid-cols-[132px_1fr]">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">Path confidence</dt>
                        <dd><ConfidenceBadge confidence={path.confidence} /> <span className="ml-2 text-stone-500">weakest edge governs</span></dd>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-[132px_1fr]">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">Confirmed facts</dt>
                        <dd>{path.confirmedFacts.length ? path.confirmedFacts.join(" ") : "No directly confirmed edge facts were attached to this path."}</dd>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-[132px_1fr]">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">Inferred</dt>
                        <dd>{path.inferredRelationships.length ? path.inferredRelationships.join(" ") : "No inferred edge relationships."}</dd>
                      </div>
                      <div className="grid gap-1 sm:grid-cols-[132px_1fr]">
                        <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-stone-400">Files involved</dt>
                        <dd>{path.files.join(" · ") || "No file paths attached."}</dd>
                      </div>
                    </dl>
                    <a
                      href={microscopeHref(report, { path: path.id, file: path.files[0] })}
                      className="mt-6 inline-flex rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
                    >
                      Inspect path
                    </a>
                    {view.otherActions.length > 0 && (
                      <div className="mt-5 rounded-xl border border-stone-900/10 bg-white/45 p-4">
                        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">Other related sensitive actions</p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {view.otherActions.map((item) => (
                            <li key={item.action} className="rounded-full border border-stone-300 bg-white/70 px-3 py-1.5 text-[12px] text-stone-700">
                              {item.action} · {item.count} supporting path{item.count === 1 ? "" : "s"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section id="files" className="scroll-mt-32">
              <SectionHeading
                label="04 · Files to fix first"
                title={view.files.length ? "Start with the files that own the evidence" : "No impacted production files"}
                help="File finding severity and related path risk remain separate."
              />
              {view.files.length > 0 ? (
                <>
                  <div className="mb-4 grid gap-3 rounded-2xl border border-white/75 bg-white/55 p-4 backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-[12px] font-medium text-stone-600">File search
                      <input value={fileFilters.query} onChange={(event) => setFileFilters({ ...fileFilters, query: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-900 outline-none focus:ring-2 focus:ring-stone-800" placeholder="Filter by path" />
                    </label>
                    {[
                      ["severity", "Severity", ["", "critical", "high", "medium", "low"]],
                      ["provenance", "Provenance", ["", "production", "documentation", "test", "fixture", "example", "generated", "unknown"]],
                      ["artifactType", "Artifact type", ["", "PROMPT", "SKILL", "WORKFLOW", "TOOL", "MCP_SERVER", "MEMORY", "ACTION"]],
                    ].map(([key, label, options]) => (
                      <label key={key as string} className="text-[12px] font-medium text-stone-600">{label as string}
                        <select
                          value={fileFilters[key as keyof typeof fileFilters]}
                          onChange={(event) => setFileFilters({ ...fileFilters, [key as string]: event.target.value })}
                          className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[13px] text-stone-900 outline-none focus:ring-2 focus:ring-stone-800"
                        >
                          {(options as string[]).map((option) => <option key={option || "all"} value={option}>{option || "All"}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <p className="mb-3 font-mono text-[11px] text-stone-500">
                    Showing {Math.min(filteredFiles.length, fileLimit)} of {filteredFiles.length} matching file{filteredFiles.length === 1 ? "" : "s"}
                    {filteredFiles.length !== view.fileCount.total ? ` from ${view.fileCount.total} total` : ""}
                  </p>
                  <div className="overflow-hidden rounded-2xl border border-white/75 bg-white/65 shadow-[0_18px_55px_-42px_rgba(28,25,23,0.7)] backdrop-blur-xl">
                    {filteredFiles.slice(0, fileLimit).map((file) => (
                      <a
                        key={file.path}
                        href={microscopeHref(report, { artifact: file.artifactId, file: file.path, issue: file.issueIds[0] })}
                        className="grid gap-4 border-t border-stone-900/10 p-5 first:border-t-0 hover:bg-white/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-inset md:grid-cols-[1fr_auto_auto] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="break-all font-mono text-[13px] font-medium text-stone-900">{file.path}</p>
                            <ProvenanceBadge provenance={file.provenance} />
                          </div>
                          <p className="mt-2 text-[12px] leading-5 text-stone-500">{artifactLabel(file.artifactType)} · {file.role}</p>
                          <p className="mt-1 text-[12px] leading-5 text-stone-600">{file.recommendedAction || "Open the file to review its evidence and report-backed remediation."}</p>
                        </div>
                        <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
                          <RiskBadge risk={file.highestPathRisk} label={`Path · ${file.highestPathRisk}`} />
                          <RiskBadge risk={file.fileFindingSeverity} label={`File · ${file.fileFindingSeverity}`} />
                        </div>
                        <div className="font-mono text-[11px] text-stone-500 md:text-right">
                          <div>{file.issueCount} issue{file.issueCount === 1 ? "" : "s"}</div>
                          <div className="mt-1">{file.relatedPathCount} path{file.relatedPathCount === 1 ? "" : "s"}</div>
                        </div>
                      </a>
                    ))}
                  </div>
                  {filteredFiles.length === 0 && <p className="mt-4 text-[13px] text-stone-500">No files match these filters.</p>}
                  {filteredFiles.length > fileLimit && (
                    <button type="button" onClick={() => setFileLimit((value) => value + 20)} className="mt-5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-[12px] font-semibold">Show 20 more</button>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50/60 p-6 text-[14px] leading-6 text-emerald-900">
                  No production-relevant files were indexed for remediation. Review scan coverage and non-production findings below.
                </div>
              )}
            </section>

            <section id="remediation" className="scroll-mt-32">
              <Disclosure
                id="remediation-details"
                title="Prioritized remediation details"
                description={
                  view.remediationCount.hidden > 0
                    ? `Showing ${view.remediationCount.visible} of ${view.remediationCount.total} production finding${view.remediationCount.total === 1 ? "" : "s"}`
                    : `${view.remediationCount.total} production finding${view.remediationCount.total === 1 ? "" : "s"}`
                }
              >
                <WhatWhy
                  what="A to-do list of everything worth fixing, sorted most-important first. Each item says what's wrong, which file it's in, and shows the risky code next to a safer version."
                  why="Start at the top and work down — the first item removes the most risk for the least effort."
                />
                {(() => {
                  const laneCounts: Record<FindingLane, number> = { security: 0, reliability: 0, quality: 0 };
                  for (const item of view.remediation) laneCounts[findingLane(item.ruleId, item.title)] += 1;
                  const visible = view.remediation.filter((item) => remediationLanes.has(findingLane(item.ruleId, item.title)));
                  return (
                    <>
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        {(["security", "reliability", "quality"] as FindingLane[]).map((lane) => {
                          const on = remediationLanes.has(lane);
                          return (
                            <button
                              key={lane}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggleRemediationLane(lane)}
                              className={`rounded-full border px-3 py-1.5 font-mono text-[11px] font-medium transition ${on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white text-stone-500 hover:bg-stone-50"}`}
                            >
                              {LANE_LABEL[lane]} · {laneCounts[lane]}
                            </button>
                          );
                        })}
                      </div>
                      {visible.length > 0 ? (
                        <ol className="space-y-3">
                          {visible.map((item, index) => (
                            <li key={item.id} className="grid gap-4 rounded-2xl border border-white/75 bg-white/65 p-5 backdrop-blur-xl sm:grid-cols-[38px_1fr_auto] sm:items-start">
                              <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-stone-900 font-mono text-[12px] text-white">{index + 1}</span>
                              <div>
                                <span className="mb-1 inline-block rounded-full border border-stone-300 bg-white/70 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-stone-600">{LANE_LABEL[findingLane(item.ruleId, item.title)]}</span>
                                <p className="text-[15px] font-semibold text-stone-900">{item.title}</p>
                                <p className="mt-1 text-[13px] leading-6 text-stone-600">{item.description}</p>
                                {item.currentPattern && item.safePattern ? (
                                  <CodeDiff
                                    className="mt-3"
                                    before={item.currentPattern}
                                    after={item.safePattern}
                                    beforeLabel="Before — current code"
                                    afterLabel="After — safe pattern"
                                  />
                                ) : item.safePattern ? (
                                  <code className="mt-2 block max-w-full overflow-x-auto rounded-lg bg-stone-900/5 px-3 py-2 font-mono text-[12px] leading-5 text-stone-700">{item.safePattern}</code>
                                ) : null}
                                <p className="mt-2 break-all font-mono text-[11px] text-stone-500">{item.files.join(" · ")}</p>
                                <p className="mt-1 font-mono text-[10px] text-stone-400">Rule · {item.ruleId}</p>
                              </div>
                              <span className="rounded-lg border border-stone-300 bg-white/65 px-3 py-2 font-mono text-[11px] text-stone-600">Effort · {item.effort}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-[13px] text-stone-500">{view.remediation.length > 0 ? "No remediation items in the selected categories." : "No production remediation items were included in this report."}</p>
                      )}
                    </>
                  );
                })()}
              </Disclosure>
            </section>

            <section id="paths" className="space-y-4 scroll-mt-32">
              <Disclosure
                id="path-browser"
                title="Execution paths"
                description={
                  view.pathCount.hidden > 0
                    ? `Showing ${view.pathCount.visible} grouped path families from ${view.pathCount.total} canonical path${view.pathCount.total === 1 ? "" : "s"}`
                    : `${view.pathCount.total} canonical path${view.pathCount.total === 1 ? "" : "s"}`
                }
              >
                <WhatWhy
                  what="A step-by-step trail showing how an instruction in a file could actually end up doing something risky — like running a command, reading your files, or reaching the internet. You can filter the list to focus on what matters."
                  why="It proves a problem is real and can actually happen, not just scary-looking text — and lets you click straight to the file where the trail starts."
                />
                {path && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-900/10 bg-white/55 p-4">
                    {path.nodes.map((node, index) => (
                      <span key={node.id} className="contents">
                        {index > 0 && <span className="text-stone-300" aria-hidden="true">→</span>}
                        <span className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-[11px]">{node.relativePath || node.label}</span>
                      </span>
                    ))}
                    <ConfidenceBadge confidence={path.confidence} />
                  </div>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="text-[11px] font-medium text-stone-600">File
                    <input value={pathFilters.file} onChange={(event) => setPathFilters({ ...pathFilters, file: event.target.value })} className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[12px] text-stone-900 outline-none focus:ring-2 focus:ring-stone-800" placeholder="Filter by path" />
                  </label>
                  {[
                    ["action", "Action", ["", ...Object.keys(report.summary.reachableSensitiveActions)]],
                    ["severity", "Severity", ["", "critical", "high", "medium", "low"]],
                    ["confidence", "Confidence", ["", "confirmed", "probable", "potential"]],
                    ["provenance", "Provenance", ["", "production", "documentation", "test", "fixture", "example", "generated", "unknown"]],
                    ["artifactType", "Artifact type", ["", "PROMPT", "SKILL", "WORKFLOW", "TOOL", "MCP_SERVER", "MEMORY", "ACTION"]],
                  ].map(([key, label, options]) => (
                    <label key={key as string} className="text-[11px] font-medium text-stone-600">{label as string}
                      <select
                        value={pathFilters[key as keyof typeof pathFilters]}
                        onChange={(event) => setPathFilters({ ...pathFilters, [key as string]: event.target.value })}
                        className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[12px] text-stone-900 outline-none focus:ring-2 focus:ring-stone-800"
                      >
                        {(options as string[]).map((option) => <option key={option || "all"} value={option}>{option || "All"}</option>)}
                      </select>
                    </label>
                  ))}
                </div>

                <div className="mt-6 divide-y divide-stone-900/10">
                  {filteredPaths.slice(0, pathLimit).map((item) => (
                    <div key={item.id} className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
                      <div>
                        <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] leading-6 text-stone-700">
                          {item.nodes.map((node, index) => (
                            <span key={node.id} className="contents">
                              {index > 0 && <span className="text-stone-300">→</span>}
                              <span>{node.relativePath || node.label}</span>
                            </span>
                          ))}
                        </p>
                        <p className="mt-1 text-[11px] text-stone-500">
                          {item.action || "No action"} · {item.files.length} involved file{item.files.length === 1 ? "" : "s"} · {item.provenance}
                          {item.instanceCount > 1 ? ` · ${item.instanceCount} related route instances` : ""}
                        </p>
                        {item.instanceCount > 1 && (
                          <details className="mt-2">
                            <summary className="cursor-pointer font-mono text-[11px] font-medium text-stone-700 hover:underline">Expand instances</summary>
                            <p className="mt-2 break-all font-mono text-[11px] leading-5 text-stone-500">{item.instanceIds.join(" · ")}</p>
                          </details>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <RiskBadge risk={item.risk} />
                        <ConfidenceBadge confidence={item.confidence} />
                        <a href={microscopeHref(report, { path: item.id, file: item.files[0] })} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold text-stone-800 hover:bg-stone-50">Inspect</a>
                      </div>
                    </div>
                  ))}
                </div>
                {filteredPaths.length === 0 && <p className="mt-6 text-[13px] text-stone-500">No paths match these filters.</p>}
                {filteredPaths.length > pathLimit && (
                  <button type="button" onClick={() => setPathLimit((value) => value + 20)} className="mt-5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-[12px] font-semibold">Show 20 more</button>
                )}
              </Disclosure>

              <Disclosure
                id="architecture-overview"
                title="Show architecture overview"
                description="Clustered categories, not a fabricated full graph"
              >
                <WhatWhy
                  what="A simple map of your AI setup in four groups: where instructions come from, what coordinates them, the tools they can use, and the risky things those tools can do — with a count for each group."
                  why="A quick bird's-eye view of what you have and how much of it can take action, before you dig into the details."
                />
                <div className="grid gap-3">
                  {view.architecture.map((cluster, index) => (
                    <div key={cluster.id}>
                      {index > 0 && <div className="mx-auto h-5 w-px bg-stone-300" aria-hidden="true" />}
                      <details className={`rounded-xl border p-4 ${cluster.id === "sensitiveActions" ? "border-red-300 bg-red-50/55" : "border-stone-300 bg-white/55"}`}>
                        <summary className="cursor-pointer list-none font-sans text-[18px] font-medium">
                          {cluster.id === "instructionSources" ? "Instruction sources" : cluster.id === "orchestration" ? "Agent orchestration" : cluster.id === "toolLayer" ? "Tool layer" : "Sensitive actions"}
                          <span className="ml-3 font-mono text-[11px] font-normal text-stone-500">{cluster.count} node{cluster.count === 1 ? "" : "s"}</span>
                        </summary>
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {cluster.nodes.map((node) => <li key={node.id} className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-[10px]">{node.relativePath || node.label}</li>)}
                        </ul>
                      </details>
                    </div>
                  ))}
                </div>
              </Disclosure>

              <Disclosure
                id="evidence"
                title="Evidence"
                description={`${view.evidenceCount.visible} renderable evidence item${view.evidenceCount.visible === 1 ? "" : "s"} from ${view.evidenceCount.total} canonical evidence record${view.evidenceCount.total === 1 ? "" : "s"}`}
              >
                <WhatWhy
                  what="The receipts. For every problem we flag, this shows the exact file and line, and the actual piece of text that triggered it."
                  why="You can open that line in your editor and see it for yourself, or send it to a teammate. We never claim a problem without showing you where it is."
                />
                {view.evidence.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-left">
                      <thead>
                        <tr className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone-400">
                          <th className="pb-3 pr-4 font-medium">Location</th>
                          <th className="pb-3 pr-4 font-medium">Snippet</th>
                          <th className="pb-3 pr-4 font-medium">Rule</th>
                          <th className="pb-3 font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.evidence.map((evidence) => (
                          <tr key={`${evidence.issueId}:${evidence.id}`} className="border-t border-stone-900/10 align-top">
                            <td className="py-4 pr-4 font-mono text-[12px]">
                              {evidence.filePath}
                              {evidence.kind === "direct" && evidence.line ? `:${evidence.line}` : ""}
                              {evidence.kind === "direct" && evidence.column ? `:${evidence.column}` : ""}
                              {evidence.kind === "absence" && evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}
                            </td>
                            <td className="py-4 pr-4">
                              {evidence.kind === "direct" ? (
                                <code className="rounded-md bg-amber-100/75 px-2 py-1 font-mono text-[12px] leading-5 text-amber-900">{evidence.snippet || "No snippet available"}</code>
                              ) : (
                                <span className="block rounded-md bg-stone-100/80 px-3 py-2 text-[12px] leading-5 text-stone-700">
                                  <b>{evidence.scopeLabel}:</b> {evidence.missingRequirement}
                                </span>
                              )}
                            </td>
                            <td className="py-4 pr-4 font-mono text-[11px] text-stone-500">{evidence.ruleId}</td>
                            <td className="py-4"><ConfidenceBadge confidence={evidence.confidence.level} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-[13px] text-stone-500">No issue evidence was included in this report.</p>}
              </Disclosure>

              <Disclosure
                id="non-production-findings"
                title="Non-production findings"
                description={`${view.nonProduction.total} finding${view.nonProduction.total === 1 ? "" : "s"} · excluded from the main verdict unless connected to production execution`}
              >
                <WhatWhy
                  what="Problems we found in files that aren't part of your live product — things like documentation, tests, and examples."
                  why="We list them so nothing is hidden, but we don't count them against your safety score — a scary-looking test file shouldn't make your real product look unsafe. If one is actually used by the live product, it still shows up in the trail above."
                />
                {view.nonProduction.total > 0 ? (
                  <div>
                    <div className="divide-y divide-stone-900/10">
                      {Object.entries(view.nonProduction.byProvenance).map(([provenance, count]) => (
                        <div key={provenance} className="flex items-center gap-5 py-4">
                          <span className="w-14 font-sans text-[24px] font-semibold text-stone-500">{count}</span>
                          <div>
                            <p className="text-[14px] font-medium capitalize">{provenance} findings</p>
                            <p className="mt-1 text-[12px] text-stone-500">Visible for completeness; not counted in the production trust verdict by provenance alone.</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-[13px] leading-6 text-stone-600">Reachability from production remains visible in canonical paths; directory names alone do not make an artifact harmless.</p>
                  </div>
                ) : <p className="text-[13px] text-stone-500">No non-production findings were reported.</p>}
              </Disclosure>

              <Disclosure
                id="exports"
                title="Exports"
                description="SARIF, HTML and JSON come from the canonical report; Markdown and the GitHub comment are generated from it client-side"
              >
                <WhatWhy
                  what="Download the results in different formats so other tools can read them — a security-dashboard format (SARIF), a shareable web page (HTML), raw data for scripts (JSON), or a ready-to-paste comment for a pull request."
                  why="Drop these into the tools you already use — like your build pipeline or a code review — without running the scan again."
                />
                <div className="flex flex-wrap gap-3">
                  {report.exports?.json && <button type="button" onClick={() => exportReport("json")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">Download JSON</button>}
                  {report.exports?.sarif && <button type="button" onClick={() => exportReport("sarif")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">Download SARIF</button>}
                  {report.exports?.html && <button type="button" onClick={() => exportReport("html")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">Download HTML</button>}
                  {report.exports?.mapJson && <button type="button" onClick={() => exportReport("mapJson")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">Execution-map JSON</button>}
                  <button type="button" onClick={() => exportReport("markdown")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">Download Markdown</button>
                  <button type="button" onClick={() => exportReport("githubComment")} className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-[12px] font-semibold hover:bg-stone-50">{copiedComment ? "Copied to clipboard" : "Copy GitHub comment"}</button>
                </div>
              </Disclosure>
            </section>

            {scanMeta && (
              <footer className="flex flex-col gap-3 border-t border-stone-900/10 pt-6 text-[11px] text-stone-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {scanMeta.filesWritten} files processed by the configured dashboard service · {scanMeta.filesSkipped} upload files skipped
                  {scanMeta.timings ? ` · ${(scanMeta.timings.totalMs / 1_000).toFixed(2)}s total` : ""}
                </span>
                <button type="button" onClick={() => {
                  setReport(null);
                  setFiles([]);
                  setSelectionStats({
                    total: 0,
                    eligible: 0,
                    queued: 0,
                    excludedByFileLimit: 0,
                    excludedByPayloadLimit: 0,
                    estimatedChars: 0,
                  });
                  setScanMeta(null);
                }} className="text-left font-mono font-medium text-stone-800 hover:underline">Start a new scan</button>
              </footer>
            )}
          </div>
        )}
      </main>
    </PreviewShell>
  );
}
