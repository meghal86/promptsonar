import type {
  RepositoryScan,
  Severity,
  Confidence,
  Provenance,
  GraphData,
  GraphNode,
  GraphEdge,
  AffectedFile,
  ExecutionPath,
  PathNode,
  RemediationStep,
  EvidenceRecord,
  NonProdGroup,
} from "@/types/repository";

/**
 * Adapts the core `RepositoryExecutionReport` (from @promptsonar/core, via the
 * /api/repository endpoint) into the richer v2 `RepositoryScan` shape the
 * Explorer screens render. Parts of the v2 view (graph layout, business
 * impact, before/after fix code) are synthesized from the report, since the
 * core report does not carry them directly.
 *
 * The report is typed loosely as `any` to avoid bundling core types into the
 * client; all access is defensive.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RepoReport = any;

const NON_PROD = new Set([
  "documentation",
  "test",
  "fixture",
  "example",
  "generated",
]);

function normSeverity(value: unknown): Severity {
  const s = String(value ?? "").toLowerCase();
  if (s === "critical" || s === "high" || s === "medium" || s === "low")
    return s;
  if (s === "none" || s === "info" || s === "") return "info";
  return "info";
}

function normConfidence(level: unknown, label?: unknown): Confidence {
  const v = String(level ?? label ?? "").toLowerCase();
  if (v.startsWith("confirm")) return "confirmed";
  if (v.startsWith("prob")) return "probable";
  return "potential";
}

// Core node/artifact type → v2 provenance bucket (config files get their own
// badge in v2, which core models as `production` + an artifact type).
function provenanceFor(coreType: string, coreProvenance?: string): Provenance {
  const t = String(coreType || "").toUpperCase();
  if (["MCP_SERVER", "TOOL", "AGENT_CONFIG", "WORKFLOW"].includes(t))
    return "configuration";
  const p = String(coreProvenance || "").toLowerCase();
  if (p === "documentation" || p === "generated") return "documentation";
  if (p === "test") return "test";
  if (p === "fixture" || p === "example") return "fixture";
  return "production";
}

const ARTIFACT_LABEL: Record<string, string> = {
  PROMPT: "Prompt",
  SKILL: "Skill",
  MCP_SERVER: "MCP config",
  AGENT_CONFIG: "Agent config",
  MEMORY: "Memory",
  TOOL: "Tool router",
  WORKFLOW: "Workflow",
  ACTION: "Action",
};

const IMPACTED_LABEL: Record<string, string> = {
  "SKILL.md": "Skill",
  "MCP Config": "MCP config",
  Workflow: "Workflow",
  Prompt: "Prompt",
  Other: "Artifact",
};

const NODE_TYPE: Record<string, PathNode["type"]> = {
  PROMPT: "prompt",
  SKILL: "skill",
  WORKFLOW: "workflow",
  TOOL: "tool-router",
  MCP_SERVER: "mcp-server",
  MEMORY: "memory",
  ACTION: "action",
};

function truncate(s: string, n = 22): string {
  const str = String(s || "");
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function colOf(type: string): 0 | 1 | 2 {
  const t = String(type || "").toUpperCase();
  if (t === "PROMPT" || t === "WORKFLOW") return 0;
  if (t === "ACTION") return 2;
  return 1;
}

const EFFORT_TIME: Record<string, string> = {
  Quick: "5 min",
  Moderate: "15 min",
  Large: "1 hr",
};

const EFFORT_LEVEL: Record<string, RemediationStep["effort"]> = {
  Quick: "low",
  Moderate: "medium",
  Large: "high",
};

const IMPACT_LEVEL: Record<string, RemediationStep["impact"]> = {
  critical: "high",
  high: "high",
  medium: "medium",
  low: "low",
  info: "low",
};

const BUSINESS_IMPACT: Record<string, { title: string; description: string }> = {
  Filesystem: {
    title: "Files can be modified",
    description: "Read and write access to your filesystem",
  },
  Secrets: {
    title: "Secrets can be exposed",
    description: "API keys and credentials within reach",
  },
  Network: {
    title: "External systems can be contacted",
    description: "Outbound network and third-party APIs",
  },
  Shell: {
    title: "Commands can run on your machine",
    description: "Shell execution with your machine's permissions",
  },
  "External APIs": {
    title: "Third-party APIs can be called",
    description: "Outbound calls to external services",
  },
};

function buildGraph(report: RepoReport, hotNodeIds: Set<string>): GraphData {
  const coreNodes: RepoReport[] = report?.executionMap?.nodes ?? [];
  const coreEdges: RepoReport[] = report?.executionMap?.edges ?? [];

  // Bucket by column, cap at 5 rows per column for the fixed 5-row layout.
  const byCol: Record<0 | 1 | 2, RepoReport[]> = { 0: [], 1: [], 2: [] };
  for (const n of coreNodes) byCol[colOf(n.type)].push(n);

  const nodes: GraphNode[] = [];
  const included = new Set<string>();
  (Object.keys(byCol) as unknown as Array<0 | 1 | 2>).forEach((col) => {
    byCol[col].slice(0, 5).forEach((n, row) => {
      included.add(n.id);
      nodes.push({
        id: n.id,
        type: NODE_TYPE[String(n.type).toUpperCase()] ?? "action",
        name: truncate(n.label ?? n.id, 20),
        col: Number(col) as 0 | 1 | 2,
        row,
        isSink: String(n.type).toUpperCase() === "ACTION",
        isHot: hotNodeIds.has(n.id),
      });
    });
  });

  const edges: GraphEdge[] = [];
  for (const e of coreEdges) {
    if (!included.has(e.from) || !included.has(e.to)) continue;
    const confirmed =
      String(e.confidenceLabel || "").toLowerCase() === "confirmed" ||
      (hotNodeIds.has(e.from) && hotNodeIds.has(e.to));
    edges.push({ from: e.from, to: e.to, isConfirmedRoute: confirmed });
  }

  return { nodes, edges };
}

function buildPathNodes(report: RepoReport, nodeIds: string[]): PathNode[] {
  const map = new Map<string, RepoReport>(
    (report?.executionMap?.nodes ?? []).map((n: RepoReport) => [n.id, n]),
  );
  return nodeIds.map((id, i) => {
    const n = map.get(id);
    const type = String(n?.type ?? "ACTION").toUpperCase();
    return {
      id,
      type: NODE_TYPE[type] ?? "action",
      name: n?.label ?? id,
      isSink: type === "ACTION",
      edgeLabel:
        i < nodeIds.length - 1 ? normConfidence(n?.confidenceLabel) : undefined,
    };
  });
}

function toExecutionPath(report: RepoReport, p: RepoReport): ExecutionPath {
  return {
    id: String(p.id),
    nodes: buildPathNodes(report, p.nodeIds ?? []),
    severity: normSeverity(p.risk ?? p.severity),
    confidence: normConfidence(p.confidenceLevel, p.confidenceLabel),
    fileCount: (p.files ?? []).length,
    confirmedFacts: "",
    inferred: String(p.explanation ?? ""),
    filesInvolved: (p.files ?? []).map((f: string) =>
      String(f).split("/").slice(-1)[0],
    ),
  };
}

export function adaptRepositoryReport(
  report: RepoReport,
  opts: { scanMode: RepositoryScan["scanMode"]; name?: string },
): RepositoryScan {
  const summary = report?.summary ?? {};
  const artifacts: RepoReport[] = report?.artifacts ?? [];
  const reachable: RepoReport[] = report?.reachablePaths ?? [];
  const issues: RepoReport[] = report?.issues ?? [];

  // Production-first, severity-ordered issues.
  const sevRank: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
  };
  const sortedIssues = [...issues].sort(
    (a, b) =>
      (NON_PROD.has(a.provenance ?? "production") ? 0 : 1) -
        (NON_PROD.has(b.provenance ?? "production") ? 0 : 1) ||
      sevRank[normSeverity(b.severity)] - sevRank[normSeverity(a.severity)] ||
      (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0),
  );

  const topPath = reachable[0];
  const hotNodeIds = new Set<string>(topPath?.nodeIds ?? []);

  // Verdict
  const overallRisk = normSeverity(summary.overallRisk);
  const trustStatusRaw = String(summary.trustStatus ?? "Review Required");
  const trustStatus: RepositoryScan["verdict"]["trustStatus"] =
    trustStatusRaw === "Trusted"
      ? "pass"
      : trustStatusRaw === "High Risk"
        ? "fail"
        : "review-required";
  const highestPathConfidence = normConfidence(
    topPath?.confidenceLevel,
    topPath?.confidenceLabel,
  );

  const topAction =
    topPath?.sensitiveActions?.[0] ?? topPath?.sensitiveAction ?? "a sensitive action";
  const summaryLine =
    reachable.length > 0
      ? `A path can reach ${String(topAction).toLowerCase()} — review how it is wired.`
      : "No reachable path to a sensitive action was found.";

  const topIssue = sortedIssues[0];
  const confirmedSummary =
    topIssue?.issue ??
    (report?.evidence ?? [])[0]?.snippet ??
    "see evidence below";
  const inferredSummary =
    buildPathNodes(report, topPath?.nodeIds ?? [])
      .map((n) => n.name)
      .join(" → ") || "routing inferred from references";

  // Coverage
  const stats = summary.scanStats ?? {};
  const skip = stats.skipReasons ?? {};
  const productionArtifacts = artifacts.filter(
    (a) => !NON_PROD.has(a.provenance ?? "production"),
  ).length;

  // Risk score (0–100), synthesized from the severity histogram.
  const rs = summary.riskSummary ?? {};
  const riskScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (rs.critical ?? 0) * 40 +
          (rs.high ?? 0) * 18 +
          (rs.medium ?? 0) * 7 +
          (rs.low ?? 0) * 2,
      ),
    ),
  );

  // Next action
  const naFile =
    topIssue?.impactedFiles?.[0] ??
    topIssue?.evidence?.[0]?.file ??
    report?.impactedFiles?.[0]?.path ??
    "the highest-risk file";
  const nextAction = {
    file: naFile,
    effort: EFFORT_TIME[topIssue?.fix?.effort] ?? "10 min",
    issueTitle:
      topIssue?.fix?.recommendedFix ??
      topIssue?.issue ??
      `Address the highest-risk finding in ${naFile}`,
    before: topIssue?.evidence?.[0]?.snippet ?? "// current configuration",
    after:
      topIssue?.fix?.safePattern ??
      topIssue?.fix?.recommendedFix ??
      "// constrained configuration",
  };

  // Business impact
  const actions = summary.reachableSensitiveActions ?? {};
  const businessImpact = Object.entries(actions)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([action]) => BUSINESS_IMPACT[action])
    .filter(Boolean);

  // Files
  const impacted: RepoReport[] = report?.impactedFiles ?? [];
  const artifactByPath = new Map<string, RepoReport>(
    artifacts.map((a) => [a.relativePath ?? a.filePath, a]),
  );
  const files: AffectedFile[] = impacted.map((f) => {
    const art = artifactByPath.get(f.path);
    const sev = normSeverity(f.highestSeverity);
    return {
      path: f.path,
      provenance: provenanceFor(art?.type ?? "", art?.provenance),
      artifactType: IMPACTED_LABEL[f.type] ?? art?.type ?? "Artifact",
      description: truncate(
        art?.description ?? `${f.issueCount} issue${f.issueCount === 1 ? "" : "s"}`,
        60,
      ),
      pathRisk: sev,
      fileFinding: sev,
      issueCount: f.issueCount ?? (f.issueIds ?? []).length,
      pathCount: (f.pathIds ?? []).length,
    };
  });

  // Remediation (top 3 distinct fixes)
  const remediation: RemediationStep[] = sortedIssues
    .slice(0, 3)
    .map((iss, i) => ({
      order: i + 1,
      title: iss.fix?.recommendedFix ?? iss.issue ?? `Remediation ${i + 1}`,
      codeHint: truncate(iss.fix?.safePattern ?? iss.fix?.quickFix ?? "", 48),
      fileHint: iss.impactedFiles?.[0] ?? iss.evidence?.[0]?.file ?? "",
      impact: IMPACT_LEVEL[normSeverity(iss.severity)] ?? "medium",
      effort: EFFORT_LEVEL[iss.fix?.effort] ?? "medium",
    }));

  // Evidence
  const evidence: EvidenceRecord[] = (report?.evidence ?? [])
    .slice(0, 20)
    .map((e: RepoReport) => ({
      file: e.file,
      line: e.lineStart ?? 0,
      snippet: e.snippet ?? "",
      rule: e.ruleId ?? e.type ?? "",
      confidence: normConfidence(undefined, e.confidenceLabel),
    }));

  // Non-production findings
  const byProv: Record<string, number> = summary.issuesByProvenance ?? {};
  const nonProductionFindings: NonProdGroup[] = [];
  if (byProv.documentation)
    nonProductionFindings.push({
      count: byProv.documentation,
      label: "documentation findings",
      note: "In README and docs — examples, not live wiring",
    });
  if (byProv.test || byProv.fixture)
    nonProductionFindings.push({
      count: (byProv.test ?? 0) + (byProv.fixture ?? 0),
      label: "test & fixture findings",
      note: "In test files built to exercise the rules",
    });
  if (byProv.example || byProv.generated)
    nonProductionFindings.push({
      count: (byProv.example ?? 0) + (byProv.generated ?? 0),
      label: "example & generated findings",
      note: "Sample configs and generated output, for reference",
    });

  // Paths
  const paths: ExecutionPath[] = reachable
    .slice(0, 8)
    .map((p) => toExecutionPath(report, p));

  const highestRiskPath: ExecutionPath = topPath
    ? toExecutionPath(report, topPath)
    : {
        id: "none",
        nodes: [],
        severity: overallRisk,
        confidence: highestPathConfidence,
        fileCount: 0,
        confirmedFacts: "",
        inferred: "",
        filesInvolved: [],
      };

  return {
    id: report?.id ?? `repo-${Date.now()}`,
    name: opts.name ?? report?.repository?.name ?? "Scanned repository",
    scanMode: opts.scanMode,
    scannedAt: report?.scannedAt ?? report?.generated_at ?? new Date().toISOString(),
    verdict: {
      overallRisk,
      trustStatus,
      highestPathConfidence,
      summaryLine,
      confirmedSummary: truncate(String(confirmedSummary), 90),
      inferredSummary: truncate(inferredSummary, 90),
    },
    coverage: {
      considered: stats.filesConsidered ?? summary.filesScanned ?? files.length,
      scanned: stats.filesScanned ?? summary.filesScanned ?? 0,
      skipped: stats.filesSkipped ?? 0,
      productionArtifacts,
      skippedBreakdown: {
        generated: skip.generated ?? 0,
        unsupported: skip.unsupported ?? skip.ignored ?? 0,
        binary: skip.binary ?? 0,
        oversized: skip.oversized ?? skip.tooLarge ?? 0,
      },
    },
    findings: {
      confirmed: summary.confidenceSummary?.confirmed ?? 0,
      probable: summary.confidenceSummary?.probable ?? 0,
      potential: summary.confidenceSummary?.potential ?? 0,
    },
    riskScore,
    nextAction,
    businessImpact,
    highestRiskPath,
    files,
    remediation,
    evidence,
    nonProductionFindings,
    paths,
    graph: buildGraph(report, hotNodeIds),
  };
}

export default adaptRepositoryReport;
