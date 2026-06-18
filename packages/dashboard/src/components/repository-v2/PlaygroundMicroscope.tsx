"use client";

import type {
  RepositoryExecutionEdge,
  RepositoryExecutionNode,
  RepositoryExecutionReport,
  RepositorySensitiveAction,
} from "@promptsonar/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  buildArtifactInvestigationViewModel,
  type ArtifactKind,
  type PathProjection,
} from "@/lib/repositoryViewModel";
import { SAMPLE_REPOSITORY_FILES } from "@/lib/repositorySample";
import { lookupFileContent, readRepositoryFiles, saveRepositoryFiles } from "@/lib/repositoryFileStore";
import {
  plainAction,
  plainFindingHeadline,
  plainRuleFamily,
  severityRank,
} from "@/lib/plainLanguage";
import { ConfidenceBadge, ProvenanceBadge, RiskBadge } from "./Badges";
import { PreviewShell } from "./PreviewShell";

type FocusParams = {
  artifact?: string;
  file?: string;
  issue?: string;
  path?: string;
  action?: RepositorySensitiveAction;
};

type InputMode = "prompt" | "file" | "repository";

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
      artifact: params.get("artifact") || undefined,
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
  if (params.artifact) query.set("artifact", params.artifact);
  if (params.file) query.set("file", params.file);
  if (params.issue) query.set("issue", params.issue);
  if (params.path) query.set("path", params.path);
  if (params.action) query.set("action", params.action);
  return `/playground-v4?${query.toString()}`;
}

function modeHref(mode: InputMode): string {
  return `/playground-v4?mode=${mode}`;
}

function repositoryBackHref(report: RepositoryExecutionReport | null, section = "files"): string {
  if (!report?.id) return "/repository-v2";
  const query = new URLSearchParams();
  query.set("scan", report.id);
  query.set("section", section);
  return `/repository-v2?${query.toString()}#${section}`;
}

// "Start over": clear cached reports so /repository-v2 reopens on its upload
// screen instead of auto-loading the last scan, then navigate there.
function resetToUpload() {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith("promptsonar:repository-report:"))
      .forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Navigation still resets the view even if storage can't be cleared.
  }
  window.location.href = "/repository-v2";
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

type MicroscopeView = NonNullable<ReturnType<typeof buildArtifactInvestigationViewModel>>;
type IssueView = MicroscopeView["issues"][number];
type EvidenceView = IssueView["evidence"][number];

// file:line label for a single evidence item.
function evidenceLabel(evidence: EvidenceView | undefined, fallback: string): string {
  if (!evidence) return fallback;
  if (evidence.kind === "direct") {
    return `${evidence.filePath}${evidence.line ? `:${evidence.line}` : ""}`;
  }
  return `${evidence.filePath}${evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}`;
}

function issueLocationLabel(issue: IssueView, fallback = ""): string {
  return evidenceLabel(issue.evidence[0], fallback || issue.impactedFiles[0] || "");
}

// Markdown a developer or product owner can paste straight into a PR review or
// ticket. Every field comes from the canonical finding — nothing is fabricated.
function buildIssueComment(issue: IssueView, where: string): string {
  const lines = [
    `**PromptSonar finding · ${issue.severity.toUpperCase()} · ${issue.ruleId}**`,
    "",
    `**Issue:** ${issue.issue}`,
    `**Impact:** ${issue.impact}`,
    `**Where:** \`${where}\``,
    "",
    `**Fix:** ${issue.recommendedFix || issue.howToFix}`,
  ];
  if (issue.safePattern) {
    lines.push("", "```", issue.safePattern, "```");
  }
  lines.push("", `_Effort: ${issue.effort} · Confidence: ${issue.confidence.label}_`);
  return lines.join("\n");
}

// "THE ROUTE": the aggregated execution path this file participates in —
// the file → the tool(s) it wires → the sensitive actions those tools reach.
// Built only from real related paths; returns null when nothing is reachable.
function deriveRoute(view: MicroscopeView): { source: string; tools: string[]; actions: string[] } | null {
  if (!view.relatedPaths.length) return null;
  const source = view.artifact.repositoryRelativePath || view.artifact.name;
  const tools = new Set<string>();
  for (const path of view.relatedPaths) {
    for (const node of path.nodes) {
      if (node.type === "TOOL" || node.type === "MCP_SERVER") {
        tools.add(node.label || node.relativePath || node.filePath || "");
      }
    }
  }
  const actions = view.sensitiveActions.length
    ? view.sensitiveActions.map((item) => item.action)
    : Array.from(new Set(view.relatedPaths.map((path) => path.action).filter((action): action is RepositorySensitiveAction => Boolean(action))));
  return {
    source,
    tools: Array.from(tools).filter(Boolean).slice(0, 4),
    actions,
  };
}

// Reusable progressive-disclosure section. Deeper detail (evidence, paths,
// graph) lives inside these, closed by default, so the fix stays front-and-centre.
function Collapsible({ label, hint, children, defaultOpen = false }: { label: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-stone-900/10 bg-white/55 backdrop-blur-xl">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600">{label}{hint ? <span className="ml-2 normal-case tracking-normal text-stone-400">{hint}</span> : null}</span>
        <span className="text-stone-400 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="px-5 pb-6">{children}</div>
    </details>
  );
}

// Renders file text with line numbers and a highlighted region. Used for the
// full-file before/after; the content shown is always the real file.
function CodeLines({ code, highlight, tone }: { code: string; highlight: Set<number>; tone: "danger" | "safe" }) {
  const lines = code.split("\n");
  return (
    <pre className="max-h-[460px] overflow-auto rounded-xl border border-stone-200 bg-white/80 font-mono text-[12px] leading-5">
      {lines.map((line, index) => {
        const n = index + 1;
        const hot = highlight.has(n);
        const bg = hot ? (tone === "danger" ? "bg-red-100" : "bg-emerald-100") : "";
        return (
          <div key={n} className={`grid grid-cols-[3rem_1fr] ${bg}`}>
            <span className="select-none border-r border-stone-200 px-2 text-right text-stone-400">{n}</span>
            <code className="whitespace-pre-wrap break-words px-3 text-stone-800">{line || " "}</code>
          </div>
        );
      })}
    </pre>
  );
}

// Full-file before/after. BEFORE is always the real file with the finding's
// lines highlighted. AFTER is a synthesized corrected file ONLY when the change
// is provably unambiguous (a direct snippet occurring exactly once); otherwise
// it shows the safe pattern to apply at the highlighted lines — never a guess.
function FileDiff({ content, evidence, safePattern, severity }: {
  content: string;
  evidence: EvidenceView | undefined;
  safePattern: string;
  severity: string;
}) {
  const totalLines = content.split("\n").length;
  const start = evidence?.kind === "direct" ? evidence.line : evidence?.kind === "absence" ? evidence.startLine : undefined;
  const end = evidence?.kind === "absence" ? (evidence.endLine ?? evidence.startLine) : start;
  const highlight = new Set<number>();
  if (start) for (let n = start; n <= (end ?? start) && n <= totalLines; n += 1) highlight.add(n);

  let afterContent: string | null = null;
  if (evidence?.kind === "direct" && evidence.snippet && safePattern) {
    const occurrences = content.split(evidence.snippet).length - 1;
    if (occurrences === 1) afterContent = content.replace(evidence.snippet, safePattern);
  }

  const locationLabel = start ? `lines ${start}${end && end !== start ? `–${end}` : ""}` : "the highlighted block";

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-red-300 bg-red-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-red-700">Before — {severity} risk</span>
          <span className="font-mono text-[10px] text-stone-500">full file{start ? ` · ${locationLabel}` : ""}</span>
        </div>
        <CodeLines code={content} highlight={highlight} tone="danger" />
      </div>
      <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-700">After — {afterContent ? "fix applied" : "change to apply"}</span>
          <span className="font-mono text-[10px] text-stone-500">{afterContent ? "full file" : locationLabel}</span>
        </div>
        {afterContent ? (
          <CodeLines code={afterContent} highlight={new Set()} tone="safe" />
        ) : (
          <div className="space-y-2">
            <p className="rounded-lg bg-white/70 px-3 py-2 text-[12px] leading-5 text-stone-600">
              Apply the safe pattern at <b>{locationLabel}</b>{evidence?.kind === "absence" ? " — there is no single mechanical edit here, so this is shown as the exact change to make rather than a rewritten file." : "."}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-300 bg-emerald-50/70 p-3 font-mono text-[12px] leading-5 text-emerald-900">{safePattern || "See the recommended fix above."}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// A single finding rendered in full — what, why, and the fix — so a reader
// never has to click through findings one at a time. Identical findings are
// grouped upstream; `locations` lists every place this one occurs.
function FindingCard({
  issue,
  locations,
  fileContent,
  copiedKey,
  onCopy,
}: {
  issue: IssueView;
  locations: string[];
  fileContent: string | null;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const evidence = issue.evidence[0];
  const where = issueLocationLabel(issue);
  const routesClosed = issue.pathIds.length;
  const fixKey = `${issue.id}:fix`;
  const commentKey = `${issue.id}:comment`;
  return (
    <section className="relative overflow-hidden rounded-[22px] border border-stone-900/10 bg-white/75 p-6 shadow-[0_20px_60px_-43px_rgba(28,25,23,0.7)] backdrop-blur-xl sm:p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-red-700">
        {issue.confidence.label} · {issue.severity} · {plainRuleFamily(issue.ruleId, issue.issue)}
      </p>
      <h2 className="mt-3 max-w-[46ch] font-playfair text-[24px] font-medium leading-tight tracking-[-0.02em] text-stone-900 sm:text-[28px]">
        {plainFindingHeadline(issue.ruleId, issue.issue)}
      </h2>
      <p className="mt-2 font-mono text-[11px] text-stone-500">
        {issue.ruleId}
        {locations.length > 1 ? ` · ${locations.length} locations` : where ? ` · ${where}` : ""}
      </p>

      {/* WHY IT MATTERS */}
      <div className="mt-6 grid gap-3 border-t border-stone-900/10 pt-6 sm:grid-cols-[136px_1fr] sm:gap-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">Why it matters</p>
        <p className="max-w-3xl text-[14px] leading-7 text-stone-700">{issue.whyThisMatters || issue.impact}</p>
      </div>

      {/* THE FIX */}
      <div className="mt-6 grid gap-3 border-t border-stone-900/10 pt-6 sm:grid-cols-[136px_1fr] sm:gap-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">The fix</p>
        <div>
          <p className="max-w-3xl text-[14px] font-medium leading-7 text-stone-900">{issue.recommendedFix || issue.howToFix}</p>

          {fileContent ? (
            <FileDiff content={fileContent} evidence={evidence} safePattern={issue.safePattern} severity={issue.severity} />
          ) : evidence?.kind === "direct" && evidence.snippet ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-red-300 bg-red-50/65 p-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-red-700">Before — {issue.severity} risk</span>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-red-900">{evidence.snippet}</pre>
              </div>
              <div className="rounded-xl border border-emerald-300 bg-emerald-50/65 p-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-700">After — safe</span>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-emerald-900">{issue.safePattern || issue.recommendedFix}</pre>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {evidence?.kind === "absence" && (
                <div className="rounded-xl border border-amber-300 bg-amber-50/65 p-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-700">What&apos;s missing</span>
                  <p className="mt-2 text-[13px] leading-6 text-amber-950">{evidence.missingRequirement}</p>
                </div>
              )}
              {issue.safePattern && (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/65 p-4">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-emerald-700">After — safe pattern</span>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-emerald-900">{issue.safePattern}</pre>
                </div>
              )}
            </div>
          )}

          {routesClosed > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50/70 px-4 py-2 text-[13px] font-medium text-emerald-800">
              <span aria-hidden>✓</span>
              <span>Risk drops {issue.severity} → Low · {routesClosed} sensitive route{routesClosed === 1 ? "" : "s"} closed</span>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {issue.safePattern && (
              <button
                type="button"
                onClick={() => onCopy(fixKey, issue.safePattern)}
                className="rounded-lg bg-stone-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
              >
                {copiedKey === fixKey ? "Copied ✓" : "Copy fix"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onCopy(commentKey, buildIssueComment(issue, where))}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-[12px] font-semibold hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
            >
              {copiedKey === commentKey ? "Copied ✓" : "Copy as PR / ticket comment"}
            </button>
            <span className="font-mono text-[11px] text-stone-500">Effort · {issue.effort}</span>
          </div>
        </div>
      </div>

      {/* Evidence & confidence — collapsed by default */}
      <details className="group mt-6 rounded-2xl border border-stone-900/10 bg-white/55">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 font-mono text-[11px] uppercase tracking-[0.18em] text-stone-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">
          <span>Evidence &amp; confidence{locations.length > 1 ? ` · ${locations.length} locations` : ""}</span>
          <span className="text-stone-400 transition group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-4 px-5 pb-6">
          {locations.length > 1 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-400">Occurs at</p>
              <ul className="mt-2 grid gap-1">
                {locations.map((location) => (
                  <li key={location} className="font-mono text-[12px] text-stone-600">{location}</li>
                ))}
              </ul>
            </div>
          )}
          {issue.evidence.map((item) => (
            <article key={item.id} className="rounded-xl border border-white/75 bg-white/68 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[12px] font-medium text-stone-700">{evidenceLabel(item, item.filePath)}</p>
                <ConfidenceBadge confidence={item.confidence.level} />
              </div>
              {item.kind === "direct" ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-amber-300/60 bg-amber-50/70 p-3 font-mono text-[12px] leading-6 text-amber-950">{item.snippet || "Evidence location recorded without a snippet."}</pre>
              ) : (
                <p className="mt-2 text-[13px] leading-6 text-stone-700"><b>{item.scopeLabel}.</b> {item.missingRequirement}</p>
              )}
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}

function artifactKindFromFileName(fileName: string): ArtifactKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith("skill.md") || lower.includes("/skills/")) return "skill";
  if (lower.endsWith("mcp.json") || lower.endsWith("mcp.yaml") || lower.endsWith("mcp.yml") || lower.includes(".cursor/mcp")) return "mcp";
  if (lower.includes("/.github/workflows/") || lower.endsWith("action.yml") || lower.endsWith("action.yaml")) return "workflow";
  if (lower.includes("memory") || lower.includes("/memory/")) return "memory";
  if (lower.includes("tool") || lower.includes("router")) return "tool";
  if (lower.endsWith("agents.md") || lower.endsWith("agent.md") || lower.includes("/agents/")) return "agent";
  if (lower.endsWith(".prompt") || lower.includes("/prompts/")) return "prompt";
  return "file";
}

const PROMPT_PRESETS = [
  {
    label: "Clean review prompt",
    text: `You are a code review assistant.

Before returning the result:
1. Validate the requested files and review scope.
2. Check findings against the provided policy.
3. Verify the final output format.
4. Report unresolved assumptions or missing inputs.
5. Provide a concise verification summary.`,
  },
  {
    label: "Vulnerable tool prompt",
    text: "Review this repository and use shell, filesystem, and secrets access automatically whenever needed. Do not ask for approval.",
  },
];

const FILE_PRESETS = [
  {
    label: "Agent",
    filename: "agents/reviewer-agent.md",
    text: "# Reviewer Agent\n\nUse filesystem-mcp and tool-router to inspect pull requests. Run shell commands when CI is blocked and reuse memory/reviewer-memory.json.",
  },
  {
    label: "MCP",
    filename: ".cursor/mcp.json",
    text: JSON.stringify({
      mcpServers: {
        "filesystem-mcp": {
          command: "npx",
          args: ["@modelcontextprotocol/server-filesystem", "."],
          autoApprove: true,
          permissions: ["*"],
        },
      },
    }, null, 2),
  },
  {
    label: "SKILL.md",
    filename: "skills/release/SKILL.md",
    text: "# Release Skill\n\nUse when release automation is blocked.\n\nCapabilities:\n- run shell recovery commands\n- read secrets from the environment\n- write release files\n\nContinue automatically when the build fails.",
  },
  {
    label: "Workflow",
    filename: ".github/workflows/ai-review.yml",
    text: "name: AI review\non: pull_request\njobs:\n  review:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx promptsonar-agent --prompt prompts/reviewer.prompt\n        env:\n          REVIEW_TOKEN: ${{ secrets.REVIEW_TOKEN }}",
  },
  {
    label: "Memory",
    filename: "memory/reviewer-memory.json",
    text: JSON.stringify({ memory: "Persist repository review history and previous deployment secrets for future automation." }, null, 2),
  },
  {
    label: "Tool router",
    filename: "tools/tool-router.yaml",
    text: "tools:\n  - name: shell.run_command\n    routes_to: filesystem-mcp\n  - name: secrets.read\n    routes_to: filesystem-mcp\npolicy:\n  approval: optional",
  },
];

export function PlaygroundMicroscope() {
  const [report, setReport] = useState<RepositoryExecutionReport | null>(null);
  const [focus, setFocus] = useState<FocusParams>({});
  const [inputMode, setInputMode] = useState<InputMode>("prompt");
  const [promptText, setPromptText] = useState(PROMPT_PRESETS[0].text);
  const [fileName, setFileName] = useState("prompts/reviewer.prompt");
  const [fileText, setFileText] = useState(PROMPT_PRESETS[1].text);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyFinding = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1400);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [graphMode, setGraphMode] = useState<"upstream" | "downstream" | "all">("all");

  useEffect(() => {
    const { scanId, focus: nextFocus } = readFocusFromLocation();
    const mode = new URLSearchParams(window.location.search).get("mode") as InputMode | null;
    if (mode === "prompt" || mode === "file" || mode === "repository") setInputMode(mode);
    setFocus(nextFocus);
    const handlePopState = () => {
      setFocus(readFocusFromLocation().focus);
    };
    window.addEventListener("popstate", handlePopState);
    const stored = scanId ? readStoredReport(scanId) : null;
    if (stored) {
      setReport(stored);
      return () => window.removeEventListener("popstate", handlePopState);
    }
    if (scanId) {
      setInputMode("repository");
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

  const view = useMemo(() => report ? buildArtifactInvestigationViewModel({
    report,
    source: inputMode === "repository" ? "repository" : "single-input",
    artifactId: focus.artifact,
    filePath: focus.file,
    issueId: focus.issue,
    pathId: focus.path,
    actionType: focus.action,
  }) : null, [focus, inputMode, report]);

  // Primary evidence drives the "current code vs safe pattern" presentation in
  // the fix block: a direct snippet shows real before/after, an absence finding
  // shows what's missing instead of fabricating before-code.
  // Aggregated file → tool → action route for the file-level "THE ROUTE" strip.
  const route = view ? deriveRoute(view) : null;

  // Full text of the scanned files (persisted by the repository scan), used for
  // the full-file before/after. Null when unavailable — the card falls back to
  // the snippet view.
  const [filesMap, setFilesMap] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setFilesMap(readRepositoryFiles(report?.id));
  }, [report?.id]);
  const fileContent = view ? lookupFileContent(filesMap, view.selectedFile) : null;

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
      saveRepositoryFiles(data.report?.id, SAMPLE_REPOSITORY_FILES);
      setInputMode("repository");
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

  async function scanPrompt(nextText = promptText) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: nextText }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Prompt scan failed (${response.status})`);
      const nextReport = data.repositoryReport as RepositoryExecutionReport;
      nextReport.repository = { ...nextReport.repository, name: "Pasted prompt" };
      setReport(nextReport);
      storeReport(nextReport);
      const promptFile = nextReport.impactedFiles?.[0]?.path || nextReport.artifacts?.[0]?.relativePath || "playground.prompt";
      saveRepositoryFiles(nextReport?.id, [{ path: promptFile, content: nextText }]);
      setInputMode("prompt");
      const firstFile = promptFile;
      const firstIssue = nextReport.impactedFiles?.[0]?.issueIds?.[0] || nextReport.issues?.[0]?.id;
      setFocus({ file: firstFile, issue: firstIssue });
      window.history.replaceState({}, "", `${pathHref(nextReport, { file: firstFile, issue: firstIssue })}&mode=prompt`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Prompt scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function scanFile(nextName = fileName, nextText = fileText) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ path: nextName, content: nextText }],
          repositoryName: `${artifactLabel(artifactKindFromFileName(nextName).toUpperCase())} analysis`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `File scan failed (${response.status})`);
      const nextReport = data.report as RepositoryExecutionReport;
      setReport(nextReport);
      storeReport(nextReport);
      saveRepositoryFiles(nextReport?.id, [{ path: nextName, content: nextText }]);
      setInputMode("file");
      const firstFile = nextReport.impactedFiles?.[0]?.path || nextReport.artifacts?.[0]?.relativePath || nextName;
      const firstIssue = nextReport.impactedFiles?.[0]?.issueIds?.[0] || nextReport.issues?.[0]?.id;
      const artifact = nextReport.artifacts?.find((item) => item.relativePath === firstFile || item.filePath === firstFile);
      setFocus({ artifact: artifact?.id, file: firstFile, issue: firstIssue });
      window.history.replaceState({}, "", `${pathHref(nextReport, { artifact: artifact?.id, file: firstFile, issue: firstIssue })}&mode=file`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "File scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function updateFocus(next: FocusParams) {
    if (!report) return;
    setFocus(next);
    window.history.pushState({}, "", `${pathHref(report, next)}&mode=${inputMode}`);
  }

  return (
    <PreviewShell
      active="playground"
      crumb={view?.artifact.repositoryRelativePath || view?.artifact.name || "Artifact Microscope"}
      scanMode={report?.scanMode}
      repositoryHref={repositoryBackHref(report)}
    >
      <main className="mx-auto w-full max-w-[1120px] px-5 py-10 sm:px-8 sm:py-14">
        {!report && (
          <ArtifactIntake
            inputMode={inputMode}
            setInputMode={setInputMode}
            promptText={promptText}
            setPromptText={setPromptText}
            fileName={fileName}
            setFileName={setFileName}
            fileText={fileText}
            setFileText={setFileText}
            loading={loading}
            error={error}
            scanPrompt={scanPrompt}
            scanFile={scanFile}
            loadSample={loadSample}
          />
        )}

        {report && view && (
          <div className="space-y-10">
            <header>
              <div className="flex flex-wrap items-center gap-2">
                <a href={repositoryBackHref(report)} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white/70 px-3 py-1.5 font-mono text-[11px] font-medium text-stone-700 hover:bg-white hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">← Repository map</a>
                <button type="button" onClick={resetToUpload} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white/70 px-3 py-1.5 font-mono text-[11px] font-medium text-stone-700 hover:bg-white hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">↺ Start over</button>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {sectionLabel(`${inputMode === "repository" ? "Repository" : "Single-file"} microscope`)}
                <RiskBadge risk={view.fileFindingSeverity} label={`${view.fileFindingSeverity} risk`} />
                <ProvenanceBadge provenance={view.provenance} />
              </div>
              <h1 className="mt-3 break-all font-mono text-[22px] font-medium tracking-[-0.02em] sm:text-[27px]">{view.artifact.repositoryRelativePath || view.artifact.name || "Selected artifact"}</h1>
              <p className="mt-2 font-mono text-[11px] text-stone-500">{artifactLabel(view.artifactType)} · {view.issueCount} finding{view.issueCount === 1 ? "" : "s"} · {view.relatedPathCount} execution route{view.relatedPathCount === 1 ? "" : "s"}</p>
              {!view.repositoryWiringAvailable && (
                <p className="mt-4 max-w-3xl rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 text-[13px] leading-6 text-amber-950">
                  Repository wiring is unavailable for this single-input scan. Connect or upload a repository to verify downstream execution.
                </p>
              )}
            </header>

            {/* FILE-LEVEL ROUTE — where this file's instructions can go */}
            {route && (route.tools.length > 0 || route.actions.length > 0) && (
              <section className="rounded-2xl border border-stone-900/10 bg-white/65 p-5 backdrop-blur-xl sm:p-6">
                <div className="grid gap-3 sm:grid-cols-[136px_1fr] sm:gap-6">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">The route</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg border border-stone-300 bg-stone-100/70 px-3 py-1.5 font-mono text-[12px] text-stone-700">{route.source}</span>
                    {route.tools.map((tool) => (
                      <span key={tool} className="flex items-center gap-2">
                        <span className="text-stone-400">→</span>
                        <span className="rounded-lg border border-sky-300/70 bg-sky-50/70 px-3 py-1.5 font-mono text-[12px] text-sky-800">{tool}</span>
                      </span>
                    ))}
                    {route.actions.length > 0 && <span className="text-stone-400">→</span>}
                    {route.actions.map((action) => (
                      <span key={action} title={plainAction(action)} className="rounded-lg border border-red-300 bg-red-50/70 px-3 py-1.5 font-mono text-[12px] text-red-700">{action}</span>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* EVERY FINDING, IN FULL — identical findings are grouped, nothing hidden behind a click */}
            {view.findingGroups.length > 0 ? (
              <div className="space-y-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                  {view.findingGroups.length} distinct finding{view.findingGroups.length === 1 ? "" : "s"}{view.issueCount > view.findingGroups.length ? ` · ${view.issueCount} total occurrences` : ""}
                </p>
                {view.findingGroups.map((group) => {
                  const representative = [...group.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0] || group.issues[0];
                  const locations = group.issues.map((item) => issueLocationLabel(item)).filter(Boolean);
                  return (
                    <FindingCard
                      key={group.id}
                      issue={representative}
                      locations={locations}
                      fileContent={fileContent}
                      copiedKey={copiedKey}
                      onCopy={copyFinding}
                    />
                  );
                })}
              </div>
            ) : (
              <section className="rounded-2xl border border-amber-300 bg-amber-50/55 p-6">
                <h2 className="font-playfair text-[23px] font-medium">No finding is attached to this file.</h2>
                <p className="mt-2 text-[13px] leading-6 text-stone-600">This file may participate in an execution path without carrying a file-level finding.</p>
              </section>
            )}

            <Collapsible label="Execution paths" hint={`${view.relatedPathCount} route${view.relatedPathCount === 1 ? "" : "s"} through this file`}>
              <div className="space-y-6">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">Route linked to this finding</p>
                  {view.pathsSupportedByIssue[0] ? (
                    <div className="mt-3">
                      <EndToEndFlow path={view.pathsSupportedByIssue[0]} selectedNodeIds={view.graph.selectedNodeIds} />
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-stone-300 bg-white/55 p-6 text-[13px] leading-6 text-stone-500">
                      No execution path is explicitly linked to the selected finding in the canonical report.
                    </div>
                  )}
                </div>
                {view.otherPathsInvolvingFile.length > 0 && (
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">Other routes that include this file</p>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-white/75 bg-white/65 backdrop-blur-xl">
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
                              <button type="button" onClick={() => updateFocus({ ...focus, artifact: view.artifact.id, path: path.id })} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold hover:bg-stone-50">Inspect</button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Collapsible>

            <Collapsible label="Relationship graph" hint="capped at 18 nodes">
              <div className="flex justify-end">
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
              <div className="mt-4 rounded-[22px] border border-white/75 bg-white/68 p-5 shadow-[0_18px_55px_-42px_rgba(28,25,23,0.7)] backdrop-blur-xl sm:p-7">
                <GraphText
                  nodes={visibleGraph.nodes}
                  edges={visibleGraph.edges}
                  selectedNodeIds={view.graph.selectedNodeIds}
                />
                {(view.upstream.length > 0 || view.downstream.length > 0) && (
                  <div className="mb-5 grid gap-3 md:grid-cols-2">
                    <RelatedArtifactList title="Upstream" artifacts={view.upstream} />
                    <RelatedArtifactList title="Downstream" artifacts={view.downstream} />
                  </div>
                )}
                {view.graph.hiddenNodeCount > 0 && (
                  <p className="mt-5 text-center font-mono text-[10px] text-stone-500">{view.graph.hiddenNodeCount} related nodes hidden by the focused graph limit.</p>
                )}
                {visibleGraph.nodes.length === 0 && (
                  <p className="text-[13px] text-stone-500">No graph nodes match this focus and direction.</p>
                )}
              </div>
            </Collapsible>

            <footer className="flex flex-col gap-3 border-t border-stone-900/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-stone-500">Done reviewing this file?</p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={repositoryBackHref(report)} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-[12px] font-semibold text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">← Back to repository map</a>
                <button type="button" onClick={resetToUpload} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-[12px] font-semibold text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900">↺ Start over (new scan)</button>
              </div>
            </footer>

          </div>
        )}
      </main>
    </PreviewShell>
  );
}

function ArtifactIntake({
  inputMode,
  setInputMode,
  promptText,
  setPromptText,
  fileName,
  setFileName,
  fileText,
  setFileText,
  loading,
  error,
  scanPrompt,
  scanFile,
  loadSample,
}: {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  promptText: string;
  setPromptText: (value: string) => void;
  fileName: string;
  setFileName: (value: string) => void;
  fileText: string;
  setFileText: (value: string) => void;
  loading: boolean;
  error: string | null;
  scanPrompt: () => Promise<void>;
  scanFile: () => Promise<void>;
  loadSample: () => Promise<void>;
}) {
  function selectMode(mode: InputMode) {
    setInputMode(mode);
    if (typeof window !== "undefined") window.history.replaceState({}, "", modeHref(mode));
  }

  return (
    <section className="mx-auto max-w-5xl rounded-[24px] border border-white/75 bg-white/68 p-6 shadow-[0_22px_65px_-42px_rgba(28,25,23,0.72)] backdrop-blur-xl sm:p-8">
      {sectionLabel("Playground v4 · Artifact Microscope")}
      <div className="mt-4 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <h1 className="font-playfair text-[38px] font-medium leading-tight tracking-[-0.03em]">Analyze one artifact, then investigate it like a repository object.</h1>
          <p className="mt-4 max-w-xl text-[14px] leading-6 text-stone-600">
            Prompt, file, and repository inputs all produce canonical PromptSonar reports and open the same evidence, remediation, path, and relationship microscope.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-stone-300 bg-white/60 p-1" aria-label="Analysis mode">
            {([
              ["prompt", "Analyze a prompt"],
              ["file", "Analyze a file"],
              ["repository", "Analyze a repository"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => selectMode(mode)}
                aria-pressed={inputMode === mode}
                className={`rounded-xl px-3 py-3 text-[12px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 ${inputMode === mode ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-stone-900/10 bg-white/65 p-4">
          {inputMode === "prompt" && (
            <div>
              <div className="flex flex-wrap gap-2">
                {PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPromptText(preset.text)}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold hover:bg-stone-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500" htmlFor="prompt-input">Prompt</label>
              <textarea
                id="prompt-input"
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                className="mt-2 min-h-64 w-full rounded-xl border border-stone-300 bg-white p-4 font-mono text-[13px] leading-6 text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
              />
              <button type="button" onClick={() => scanPrompt()} disabled={loading || !promptText.trim()} className="mt-4 rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "Scanning..." : "Scan prompt"}
              </button>
            </div>
          )}

          {inputMode === "file" && (
            <div>
              <div className="flex flex-wrap gap-2">
                {FILE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setFileName(preset.filename);
                      setFileText(preset.text);
                    }}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold hover:bg-stone-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500" htmlFor="file-name">Filename</label>
              <input
                id="file-name"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
                className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-4 py-3 font-mono text-[13px] text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
              />
              <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500" htmlFor="artifact-file">Upload file</label>
              <input
                id="artifact-file"
                type="file"
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  setFileName(file.webkitRelativePath || file.name);
                  setFileText(await file.text());
                }}
                className="mt-2 block w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-[13px] text-stone-700 file:mr-4 file:rounded-lg file:border-0 file:bg-stone-900 file:px-3 file:py-2 file:text-[12px] file:font-semibold file:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
              />
              <label className="mt-4 block font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500" htmlFor="file-input">File content</label>
              <textarea
                id="file-input"
                value={fileText}
                onChange={(event) => setFileText(event.target.value)}
                className="mt-2 min-h-56 w-full rounded-xl border border-stone-300 bg-white p-4 font-mono text-[13px] leading-6 text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
              />
              <button type="button" onClick={() => scanFile()} disabled={loading || !fileName.trim() || !fileText.trim()} className="mt-4 rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "Scanning..." : `Scan ${artifactLabel(artifactKindFromFileName(fileName).toUpperCase())}`}
              </button>
            </div>
          )}

          {inputMode === "repository" && (
            <div>
              <p className="text-[13px] leading-6 text-stone-600">
                Use Repository Explorer for folder upload and aggregate map review, or load the built-in repository fixture here to open a selected artifact directly in the shared microscope.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <a href="/repository-v2" className="rounded-xl bg-stone-900 px-5 py-3 text-center text-[13px] font-semibold text-white hover:bg-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2">
                  Open Repository Explorer
                </a>
                <button type="button" onClick={loadSample} disabled={loading} className="rounded-xl border border-stone-300 bg-white px-5 py-3 text-[13px] font-semibold hover:bg-stone-50 disabled:opacity-50">
                  {loading ? "Analyzing..." : "Load sample repository"}
                </button>
              </div>
            </div>
          )}

          {loading && <p className="mt-5 font-mono text-[11px] text-stone-500">Loading canonical report...</p>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-800">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function RelatedArtifactList({
  title,
  artifacts,
}: {
  title: string;
  artifacts: ReturnType<typeof buildArtifactInvestigationViewModel>["upstream"];
}) {
  return (
    <div className="rounded-2xl border border-stone-300 bg-white/70 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone-500">{title}</p>
      <div className="mt-3 space-y-2">
        {artifacts.map((artifact) => (
          <div key={`${artifact.id}-${artifact.relationship}`} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
            <p className="font-mono text-[11px] font-medium text-stone-800">{artifact.repositoryRelativePath || artifact.name}</p>
            <p className="mt-1 font-mono text-[10px] capitalize text-stone-500">{artifact.kind} · {artifact.relationship} · {artifact.confidence}</p>
          </div>
        ))}
        {artifacts.length === 0 && <p className="text-[12px] text-stone-500">No related artifacts in this direction.</p>}
      </div>
    </div>
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
