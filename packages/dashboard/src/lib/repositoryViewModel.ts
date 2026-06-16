import type {
  ReachableExecutionPath,
  RepositoryArtifact,
  RepositoryExecutionEdge,
  RepositoryExecutionIssue,
  RepositoryExecutionNode,
  RepositoryExecutionReport,
  RepositoryPathConfidence,
  RepositoryProvenance,
  RepositoryRisk,
  RepositorySensitiveAction,
} from "@promptsonar/core";

const RISK_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

const CONFIDENCE_RANK: Record<RepositoryPathConfidence, number> = {
  confirmed: 3,
  probable: 2,
  potential: 1,
};

const NON_PRODUCTION = new Set<RepositoryProvenance>([
  "documentation",
  "test",
  "fixture",
  "example",
  "generated",
]);

const ABSENCE_REQUIREMENTS: Record<string, string> = {
  bp_missing_persona: "No bounded role or persona requirement was found within that block.",
  bp_missing_few_shot: "No example input/output behavior was found within that block.",
  bp_missing_cot: "No verification requirement or reviewable decision criteria were found within that block.",
  struct_missing_format_enforcer: "No required output format or schema enforcement was found within that block.",
};

const SENSITIVE_ACTIONS: RepositorySensitiveAction[] = [
  "Shell",
  "Filesystem",
  "Network",
  "Secrets",
  "External APIs",
];

export type CountMetadata = {
  total: number;
  visible: number;
  hidden: number;
};

export type PresentedEvidence =
  | {
      kind: "direct";
      id: string;
      issueId: string;
      filePath: string;
      line?: number;
      column?: number;
      snippet: string;
      ruleId: string;
      confidence: RepositoryExecutionIssue["confidence"];
      source: string;
    }
  | {
      kind: "absence";
      id: string;
      issueId: string;
      filePath: string;
      startLine?: number;
      endLine?: number;
      scopeLabel: string;
      missingRequirement: string;
      ruleId: string;
      confidence: RepositoryExecutionIssue["confidence"];
      source: string;
    };

export type IssuePresentation = {
  id: string;
  ruleId: string;
  issue: string;
  title: string;
  description: string;
  impact: string;
  whyThisMatters: string;
  howToFix: string;
  severity: RepositoryExecutionIssue["severity"];
  confidence: RepositoryExecutionIssue["confidence"];
  evidence: PresentedEvidence[];
  quickFix: string;
  recommendedFix: string;
  safePattern: string;
  effort: RepositoryExecutionIssue["fix"]["effort"] | "Larger change";
  fix: {
    quickFix: string;
    recommendedFix: string;
    safePattern: string;
    effort: RepositoryExecutionIssue["fix"]["effort"] | "Larger change";
    recommendationRuleId: string;
    safePatternRuleId: string;
  };
  impactedFiles: string[];
  pathIds: string[];
  provenance?: RepositoryProvenance;
  canonicalIssue: RepositoryExecutionIssue;
};

export type EdgePresentation = {
  id: string;
  relationship: string;
  confidence: RepositoryPathConfidence;
  confidenceLabel: "Confirmed" | "Probable" | "Potential";
  evidence: string;
  rule?: string;
  reason: string;
  structurallyInferred: boolean;
};

export type PathProjection = {
  id: string;
  familyId: string;
  familyLabel: string;
  risk: RepositoryRisk;
  confidence: RepositoryPathConfidence;
  confidenceLabel: "Confirmed" | "Probable" | "Potential";
  confidenceDefinition: string;
  action?: RepositorySensitiveAction;
  explanation: string;
  provenance: RepositoryProvenance;
  files: string[];
  nodes: RepositoryExecutionNode[];
  edges: RepositoryExecutionEdge[];
  edgePresentations: EdgePresentation[];
  source?: RepositoryExecutionNode;
  sink?: RepositoryExecutionNode;
  confirmedFacts: string[];
  inferredRelationships: string[];
  instanceCount: number;
  instanceIds: string[];
  instancePaths: string[];
};

export type FileProjection = {
  path: string;
  label: string;
  name: string;
  artifactType: string;
  provenance: RepositoryProvenance;
  role: string;
  fileFindingSeverity: string;
  highestPathRisk: RepositoryRisk | "none";
  issueCount: number;
  relatedPathCount: number;
  issueIds: string[];
  pathIds: string[];
  recommendedAction?: string;
};

export type FocusedGraphProjection = {
  nodes: RepositoryExecutionNode[];
  edges: RepositoryExecutionEdge[];
  edgePresentations: EdgePresentation[];
  hiddenNodeCount: number;
  selectedNodeIds: string[];
  relatedPaths: PathProjection[];
};

export function getCountMetadata(total: number, visible = total): CountMetadata {
  const boundedVisible = Math.max(0, Math.min(total, visible));
  return {
    total,
    visible: boundedVisible,
    hidden: Math.max(0, total - boundedVisible),
  };
}

export function formatRepositoryRelativePath(value = "", repositoryRoot = ""): string {
  let normalized = String(value || "").replace(/\\/g, "/").trim();
  const root = String(repositoryRoot || "").replace(/\\/g, "/").replace(/\/+$/, "");

  if (root && normalized === root) return ".";
  if (root && normalized.startsWith(`${root}/`)) {
    normalized = normalized.slice(root.length + 1);
  }

  const tempUploadMatch = normalized.match(/(?:^|\/)promptsonar-repository-[^/]+\/(.+)$/);
  if (tempUploadMatch) normalized = tempUploadMatch[1];

  const worktreeMatch = normalized.match(/(?:^|\/)\.claude\/worktrees\/[^/]+\/(.+)$/);
  if (worktreeMatch) normalized = worktreeMatch[1];

  normalized = normalized.replace(/^file:\/\//, "");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.replace(/^(?:\.\.?\/)+/, "");
  return normalized || ".";
}

export function formatDistinctPathLabel(filePath: string, allPaths: string[]): string {
  const normalized = formatRepositoryRelativePath(filePath);
  const paths = allPaths.map((item) => formatRepositoryRelativePath(item));
  const basename = normalized.split("/").pop() || normalized;
  const sameBasename = paths.filter((item) => (item.split("/").pop() || item) === basename);
  if (sameBasename.length <= 1) return basename;

  const segments = normalized.split("/").filter(Boolean);
  for (let length = 2; length <= segments.length; length += 1) {
    const candidate = segments.slice(-length).join("/");
    const collisions = sameBasename.filter((item) => item.split("/").slice(-length).join("/") === candidate);
    if (collisions.length === 1) return candidate;
  }
  return normalized;
}

function normalizePath(report: RepositoryExecutionReport, value = ""): string {
  return formatRepositoryRelativePath(value, report.repository.root);
}

function displayConfidence(level: RepositoryPathConfidence): "Confirmed" | "Probable" | "Potential" {
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}` as "Confirmed" | "Probable" | "Potential";
}

function confidenceFromLabel(label?: string): RepositoryPathConfidence {
  const normalized = String(label || "").toLowerCase();
  if (normalized === "confirmed" || normalized === "probable" || normalized === "potential") return normalized;
  return "potential";
}

function pathSort(a: ReachableExecutionPath, b: ReachableExecutionPath): number {
  return (
    RISK_RANK[b.risk] - RISK_RANK[a.risk] ||
    CONFIDENCE_RANK[b.confidenceLevel] - CONFIDENCE_RANK[a.confidenceLevel] ||
    b.confidence - a.confidence ||
    a.id.localeCompare(b.id)
  );
}

function normalizedIssueFiles(report: RepositoryExecutionReport, issue: RepositoryExecutionIssue): string[] {
  return Array.from(new Set(issue.impactedFiles.map((file) => normalizePath(report, file))));
}

function evidenceKind(evidence: RepositoryExecutionIssue["evidence"][number], ruleId: string): "direct" | "absence" {
  return evidence.kind || (ABSENCE_REQUIREMENTS[ruleId] ? "absence" : "direct");
}

function presentEvidence(
  report: RepositoryExecutionReport,
  issue: RepositoryExecutionIssue,
): PresentedEvidence[] {
  return issue.evidence.map((evidence) => {
    const kind = evidenceKind(evidence, issue.ruleId);
    const base = {
      id: evidence.id,
      issueId: issue.id,
      filePath: normalizePath(report, evidence.file),
      ruleId: issue.ruleId,
      confidence: issue.confidence,
      source: evidence.source,
    };
    if (kind === "absence") {
      return {
        ...base,
        kind: "absence",
        startLine: evidence.startLine || evidence.line,
        endLine: evidence.endLine || evidence.startLine || evidence.line,
        scopeLabel: evidence.scopeLabel || "Instruction block",
        missingRequirement: evidence.missingRequirement || ABSENCE_REQUIREMENTS[issue.ruleId] || issue.issue,
      };
    }
    return {
      ...base,
      kind: "direct",
      line: evidence.line,
      column: evidence.column,
      snippet: evidence.snippet,
    };
  });
}

export function validateIssuePresentation(issue: IssuePresentation): void {
  if (!issue.id) throw new Error("Selected issue ID is missing.");
  if (issue.fix.recommendationRuleId !== issue.ruleId) {
    throw new Error(`Recommendation rule ID ${issue.fix.recommendationRuleId} differs from issue rule ID ${issue.ruleId}.`);
  }
  if (issue.fix.safePatternRuleId !== issue.ruleId) {
    throw new Error(`Safe-pattern rule ID ${issue.fix.safePatternRuleId} differs from issue rule ID ${issue.ruleId}.`);
  }

  const issueFiles = new Set(issue.impactedFiles.map((file) => formatRepositoryRelativePath(file)));
  for (const evidence of issue.evidence) {
    if (evidence.issueId !== issue.id) {
      throw new Error(`Evidence ${evidence.id} references issue ${evidence.issueId}, not selected issue ${issue.id}.`);
    }
    if (evidence.ruleId !== issue.ruleId) {
      throw new Error(`Evidence ${evidence.id} uses rule ${evidence.ruleId}, not selected issue rule ${issue.ruleId}.`);
    }
    if (issueFiles.size > 0 && !issueFiles.has(formatRepositoryRelativePath(evidence.filePath))) {
      throw new Error(`Evidence ${evidence.id} points to ${evidence.filePath}, which is not part of issue ${issue.id}.`);
    }
  }
}

function presentIssue(report: RepositoryExecutionReport, issue: RepositoryExecutionIssue): IssuePresentation {
  const effort = issue.fix.effort === "Large" ? "Larger change" : issue.fix.effort;
  const presentation: IssuePresentation = {
    id: issue.id,
    ruleId: issue.ruleId,
    issue: issue.issue,
    title: issue.issue,
    description: issue.howToFix,
    impact: issue.impact,
    whyThisMatters: issue.whyThisMatters,
    howToFix: issue.howToFix,
    severity: issue.severity,
    confidence: issue.confidence,
    evidence: presentEvidence(report, issue),
    quickFix: issue.fix.quickFix,
    recommendedFix: issue.fix.recommendedFix,
    safePattern: issue.fix.safePattern,
    effort,
    fix: {
      quickFix: issue.fix.quickFix,
      recommendedFix: issue.fix.recommendedFix,
      safePattern: issue.fix.safePattern,
      effort,
      recommendationRuleId: issue.ruleId,
      safePatternRuleId: issue.ruleId,
    },
    impactedFiles: normalizedIssueFiles(report, issue),
    pathIds: [...issue.pathIds],
    provenance: issue.provenance,
    canonicalIssue: issue,
  };

  if (process.env.NODE_ENV !== "production") validateIssuePresentation(presentation);
  return presentation;
}

function normalizeNode(report: RepositoryExecutionReport, node: RepositoryExecutionNode): RepositoryExecutionNode {
  if (node.type === "ACTION") return { ...node };
  return {
    ...node,
    filePath: node.filePath ? normalizePath(report, node.filePath) : node.filePath,
    relativePath: node.relativePath || node.filePath ? normalizePath(report, node.relativePath || node.filePath || "") : node.relativePath,
  };
}

function actionFromNode(node?: RepositoryExecutionNode): RepositorySensitiveAction | undefined {
  const metadataAction = String(node?.metadata?.sensitiveAction || node?.metadata?.action || "");
  const label = `${metadataAction} ${node?.label || ""}`;
  return SENSITIVE_ACTIONS.find((action) => label.toLowerCase().includes(action.toLowerCase()));
}

function sensitiveActionForPath(path: ReachableExecutionPath, sink?: RepositoryExecutionNode): RepositorySensitiveAction | undefined {
  const sinkAction = sink?.type === "ACTION" ? actionFromNode(sink) : undefined;
  if (sinkAction && path.sensitiveActions.includes(sinkAction)) return sinkAction;
  if (path.sensitiveAction && path.sensitiveActions.includes(path.sensitiveAction)) return path.sensitiveAction;
  const single = path.sensitiveActions.length === 1 ? path.sensitiveActions[0] : undefined;
  return sink?.type === "ACTION" ? single : undefined;
}

function relationshipLabel(edge: RepositoryExecutionEdge): string {
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

function presentEdge(edge: RepositoryExecutionEdge): EdgePresentation {
  const confidence = confidenceFromLabel(edge.confidenceLabel);
  const structurallyInferred = edge.provenance === "structural" || (!edge.evidence && !edge.evidenceRefs?.length);
  return {
    id: edge.id,
    relationship: structurallyInferred ? "structurally inferred" : relationshipLabel(edge),
    confidence: structurallyInferred && !edge.confidenceLabel ? "potential" : confidence,
    confidenceLabel: edge.confidenceLabel || displayConfidence(structurallyInferred ? "potential" : confidence),
    evidence: edge.evidence || (structurallyInferred ? "Structurally inferred relationship" : edge.reason),
    rule: edge.evidenceRefs?.[0],
    reason: edge.reason,
    structurallyInferred,
  };
}

function pathForNode(node?: RepositoryExecutionNode): string {
  if (!node) return "";
  return node.relativePath || node.filePath || node.label;
}

function sourceFamily(node?: RepositoryExecutionNode): string {
  const value = pathForNode(node);
  const parts = value.split("/").filter(Boolean);
  const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  return `${node?.type || "UNKNOWN"}:${directory}`;
}

function pathFamilyKey(path: PathProjection): string {
  const intermediateKey = path.nodes
    .slice(1, -1)
    .map((node) => `${node.type}:${pathForNode(node) || node.label}`)
    .join(">");
  const sinkKey = path.action || path.sink?.label || "unknown-action";
  return [
    sourceFamily(path.source),
    intermediateKey,
    sinkKey,
    path.confidence,
    path.action || "",
    path.provenance,
  ].join("|");
}

function projectPath(report: RepositoryExecutionReport, path: ReachableExecutionPath): PathProjection {
  const nodesById = new Map(report.executionMap.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(report.executionMap.edges.map((edge) => [edge.id, edge]));
  const nodes = path.nodeIds
    .map((id) => nodesById.get(id))
    .filter((node): node is RepositoryExecutionNode => Boolean(node))
    .map((node) => normalizeNode(report, node));
  const edges = path.edgeIds.map((id) => edgesById.get(id)).filter((edge): edge is RepositoryExecutionEdge => Boolean(edge));
  const edgePresentations = edges.map(presentEdge);
  const source = nodes.find((node) => node.id === path.sourceNodeId) || nodes[0];
  const sink = nodes.find((node) => node.id === path.sinkNodeId) || nodes[nodes.length - 1];
  const action = sensitiveActionForPath(path, sink);
  const confirmedFacts = edgePresentations
    .filter((edge) => edge.confidence === "confirmed")
    .map((edge) => edge.reason)
    .filter(Boolean);
  const inferredRelationships = edgePresentations
    .filter((edge) => edge.confidence !== "confirmed")
    .map((edge) => edge.reason || edge.evidence)
    .filter(Boolean);
  const files = Array.from(new Set(path.files.map((file) => normalizePath(report, file))));
  const base: PathProjection = {
    id: path.id,
    familyId: path.id,
    familyLabel: "",
    risk: path.risk,
    confidence: path.confidenceLevel,
    confidenceLabel: path.confidenceLabel || displayConfidence(path.confidenceLevel),
    confidenceDefinition: path.confidenceDefinition || report.confidenceDefinitions[path.confidenceLevel],
    action,
    explanation: path.explanation,
    provenance: path.provenance || "unknown",
    files,
    nodes,
    edges,
    edgePresentations,
    source,
    sink,
    confirmedFacts,
    inferredRelationships,
    instanceCount: 1,
    instanceIds: [path.id],
    instancePaths: [path.id],
  };
  const familyId = pathFamilyKey(base);
  return {
    ...base,
    familyId,
    familyLabel: `${sourceFamily(source)} → ${action || sink?.label || "Sensitive action"}`,
  };
}

function groupPathProjections(paths: PathProjection[]): PathProjection[] {
  const groups = new Map<string, PathProjection>();
  for (const path of paths) {
    const key = path.familyId;
    const existing = groups.get(key);
    if (existing) {
      existing.instanceCount += path.instanceCount;
      existing.instanceIds.push(...path.instanceIds);
      existing.instancePaths.push(path.id);
      existing.files = Array.from(new Set([...existing.files, ...path.files]));
      existing.risk = RISK_RANK[path.risk] > RISK_RANK[existing.risk] ? path.risk : existing.risk;
    } else {
      groups.set(key, {
        ...path,
        files: [...path.files],
        instanceIds: [...path.instanceIds],
        instancePaths: [...path.instancePaths],
      });
    }
  }
  return Array.from(groups.values());
}

export function getHighestRiskPathProjection(report: RepositoryExecutionReport): PathProjection | null {
  const highest = [...report.reachablePaths].sort(pathSort)[0];
  return highest ? projectPath(report, highest) : null;
}

function pathIncludesFile(report: RepositoryExecutionReport, path: ReachableExecutionPath, filePath: string): boolean {
  const target = normalizePath(report, filePath);
  if (path.files.some((file) => normalizePath(report, file) === target)) return true;
  const nodesById = new Map(report.executionMap.nodes.map((node) => [node.id, node]));
  return path.nodeIds.some((id) => {
    const node = nodesById.get(id);
    return normalizePath(report, node?.relativePath || node?.filePath || "") === target;
  });
}

function graphProjection(
  report: RepositoryExecutionReport,
  pathPredicate: (path: ReachableExecutionPath) => boolean,
  selectedNodePredicate: (node: RepositoryExecutionNode) => boolean,
  limit = 18,
): FocusedGraphProjection {
  const paths = report.reachablePaths.filter(pathPredicate).sort(pathSort);
  const selectedNodeIds = report.executionMap.nodes.filter(selectedNodePredicate).map((node) => node.id);
  const selected = new Set(selectedNodeIds);
  const relatedEdgeIds = new Set(paths.flatMap((path) => path.edgeIds));
  const candidateEdges = report.executionMap.edges.filter(
    (edge) => relatedEdgeIds.has(edge.id) || selected.has(edge.from) || selected.has(edge.to),
  );
  const prioritizedNodeIds = Array.from(new Set([
    ...selectedNodeIds,
    ...candidateEdges.flatMap((edge) => [edge.from, edge.to]),
    ...paths.flatMap((path) => path.nodeIds),
  ]));
  const visibleNodeIds = new Set(prioritizedNodeIds.slice(0, limit));
  const nodes = report.executionMap.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => normalizeNode(report, node));
  const edges = candidateEdges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));

  return {
    nodes,
    edges,
    edgePresentations: edges.map(presentEdge),
    hiddenNodeCount: Math.max(0, prioritizedNodeIds.length - visibleNodeIds.size),
    selectedNodeIds,
    relatedPaths: paths.map((path) => projectPath(report, path)),
  };
}

export function getFileGraphProjection(
  report: RepositoryExecutionReport,
  filePath: string,
  limit = 18,
): FocusedGraphProjection {
  const target = normalizePath(report, filePath);
  return graphProjection(
    report,
    (path) => pathIncludesFile(report, path, target),
    (node) => normalizePath(report, node.relativePath || node.filePath || "") === target,
    limit,
  );
}

export function getIssueGraphProjection(
  report: RepositoryExecutionReport,
  issueId: string,
  limit = 18,
): FocusedGraphProjection {
  const issue = report.issues.find((item) => item.id === issueId);
  const pathIds = new Set(issue?.pathIds || []);
  const files = new Set((issue?.impactedFiles || []).map((file) => normalizePath(report, file)));
  return graphProjection(
    report,
    (path) => pathIds.has(path.id),
    (node) => files.has(normalizePath(report, node.relativePath || node.filePath || "")),
    limit,
  );
}

export function getActionGraphProjection(
  report: RepositoryExecutionReport,
  actionType: RepositorySensitiveAction,
  limit = 18,
): FocusedGraphProjection {
  return graphProjection(
    report,
    (path) => {
      const projection = projectPath(report, path);
      return projection.action === actionType;
    },
    (node) => node.type === "ACTION" && actionFromNode(node) === actionType,
    limit,
  );
}

export function getClusteredArchitectureProjection(report: RepositoryExecutionReport) {
  const normalize = (nodes: RepositoryExecutionNode[]) => nodes.map((node) => normalizeNode(report, node));
  const clusters = {
    instructionSources: normalize(report.executionMap.nodes.filter((node) =>
      ["PROMPT", "SKILL", "MEMORY"].includes(node.type),
    )),
    orchestration: normalize(report.executionMap.nodes.filter((node) => node.type === "WORKFLOW")),
    toolLayer: normalize(report.executionMap.nodes.filter((node) =>
      ["TOOL", "MCP_SERVER"].includes(node.type),
    )),
    sensitiveActions: normalize(report.executionMap.nodes.filter((node) => node.type === "ACTION")),
  };

  return Object.entries(clusters).map(([id, nodes]) => ({
    id,
    count: nodes.length,
    nodes,
  }));
}

function artifactForFile(report: RepositoryExecutionReport, filePath: string): RepositoryArtifact | undefined {
  const target = normalizePath(report, filePath);
  return report.artifacts.find(
    (artifact) => normalizePath(report, artifact.relativePath || artifact.filePath) === target,
  );
}

function roleForFile(path: PathProjection | null, filePath: string): string {
  if (!path) return "Impacted file";
  const target = formatRepositoryRelativePath(filePath);
  const index = path.nodes.findIndex((node) => formatRepositoryRelativePath(node.relativePath || node.filePath || "") === target);
  if (index === 0) return "Instruction source";
  if (index === path.nodes.length - 1) return "Sensitive action";
  if (index > 0) return "Execution hop";
  return "Related evidence";
}

function buildFileProjections(report: RepositoryExecutionReport): FileProjection[] {
  const canonicalPaths = report.impactedFiles.map((file) => normalizePath(report, file.path));
  return report.impactedFiles.map((file) => {
    const pathIds = new Set(file.pathIds);
    const relatedPaths = report.reachablePaths.filter(
      (path) => pathIds.has(path.id) || pathIncludesFile(report, path, file.path),
    );
    const highestPath = [...relatedPaths].sort(pathSort)[0];
    const artifact = artifactForFile(report, file.path);
    const relatedIssues = report.issues.filter((issue) => file.issueIds.includes(issue.id));
    const recommendedAction = relatedIssues
      .flatMap((issue) => [
        issue.fix?.quickFix,
        issue.fix?.recommendedFix,
        issue.howToFix,
      ])
      .find(Boolean);
    const filePath = normalizePath(report, file.path);

    return {
      path: filePath,
      label: formatDistinctPathLabel(filePath, canonicalPaths),
      name: file.name,
      artifactType: artifact?.type || file.type,
      provenance: artifact?.provenance || relatedIssues[0]?.provenance || "unknown",
      role: roleForFile(highestPath ? projectPath(report, highestPath) : null, filePath),
      fileFindingSeverity: file.highestSeverity,
      highestPathRisk: highestPath?.risk || "none",
      issueCount: file.issueCount,
      relatedPathCount: relatedPaths.length,
      issueIds: file.issueIds,
      pathIds: Array.from(new Set([...file.pathIds, ...relatedPaths.map((path) => path.id)])),
      recommendedAction,
    };
  }).sort((a, b) =>
    RISK_RANK[b.highestPathRisk] - RISK_RANK[a.highestPathRisk] ||
    RISK_RANK[b.fileFindingSeverity] - RISK_RANK[a.fileFindingSeverity] ||
    a.path.localeCompare(b.path),
  );
}

function productionArtifactCount(report: RepositoryExecutionReport): number {
  return new Set(
    report.artifacts
      .filter((artifact) => !NON_PRODUCTION.has(artifact.provenance || "unknown"))
      .map((artifact) => normalizePath(report, artifact.relativePath || artifact.filePath)),
  ).size;
}

function issueConfidenceSummary(issues: RepositoryExecutionIssue[]) {
  return issues.reduce((summary, issue) => {
    summary[issue.confidence.level] += 1;
    return summary;
  }, { confirmed: 0, probable: 0, potential: 0 } as Record<RepositoryPathConfidence, number>);
}

function actionImpact(action: RepositorySensitiveAction): string {
  const statements: Record<RepositorySensitiveAction, string> = {
    Filesystem: "Files may be read or modified through this path.",
    Shell: "Commands may run with the permissions of the configured environment.",
    Network: "This path may make network requests to reachable destinations.",
    Secrets: "Credentials or private values may be accessible through this path.",
    "External APIs": "This path may call configured external services.",
  };
  return statements[action];
}

export function buildRepositoryExplorerViewModel(report: RepositoryExecutionReport) {
  const highestRiskPath = getHighestRiskPathProjection(report);
  const productionIssues = report.issues.filter((issue) => !NON_PRODUCTION.has(issue.provenance || "unknown"));
  const nonProductionIssues = report.issues.filter((issue) => NON_PRODUCTION.has(issue.provenance || "unknown"));
  const productionIssuePresentations = productionIssues.map((issue) => presentIssue(report, issue));
  const files = buildFileProjections(report);
  const firstFile = files[0];
  const nextIssue = firstFile
    ? productionIssuePresentations.find((issue) => firstFile.issueIds.includes(issue.id))
    : productionIssuePresentations[0];
  const projectedPaths = [...report.reachablePaths].sort(pathSort).map((path) => projectPath(report, path));
  const groupedPaths = groupPathProjections(projectedPaths);
  const otherActions = Array.from(
    projectedPaths.reduce((counts, path) => {
      if (path.action && path.action !== highestRiskPath?.action) {
        counts.set(path.action, (counts.get(path.action) || 0) + 1);
      }
      return counts;
    }, new Map<RepositorySensitiveAction, number>()),
  ).map(([action, count]) => ({ action, count }));
  const evidence = report.issues.flatMap((issue) => presentIssue(report, issue).evidence);
  const visibleRemediation = productionIssuePresentations.slice(0, 8);

  return {
    repositoryName: report.repository.name,
    overallRisk: report.summary.overallRisk || "none",
    trustStatus: report.summary.trustStatus,
    highestRiskPath,
    findingConfidence: issueConfidenceSummary(productionIssues),
    coverage: {
      filesConsidered: report.summary.scanStats?.filesConsidered || 0,
      filesScanned: report.summary.scanStats?.filesScanned || report.summary.filesScanned || 0,
      filesSkipped: report.summary.scanStats?.filesSkipped || 0,
      skipReasons: report.summary.scanStats?.skipReasons || {},
      partial: Boolean(report.summary.scanStats?.truncated || report.executionMap.pathsTruncated),
    },
    productionArtifactCount: productionArtifactCount(report),
    nextAction: nextIssue && firstFile ? {
      file: firstFile.path,
      reason: nextIssue.issue,
      expectedEffect: nextIssue.impact,
      effort: nextIssue.effort,
      issueId: nextIssue.id,
    } : null,
    selectedPathImpacts: (highestRiskPath?.action ? [highestRiskPath.action] : []).map((action) => ({
      action,
      statement: actionImpact(action),
    })),
    otherActions,
    files,
    fileCount: getCountMetadata(files.length),
    remediation: visibleRemediation.map((issue) => ({
      id: issue.id,
      ruleId: issue.ruleId,
      title: issue.quickFix || issue.issue,
      description: issue.recommendedFix || issue.howToFix,
      safePattern: issue.safePattern,
      effort: issue.effort,
      files: issue.impactedFiles,
    })),
    remediationCount: getCountMetadata(productionIssuePresentations.length, visibleRemediation.length),
    totalPathCount: report.reachablePaths.length,
    paths: groupedPaths,
    pathCount: getCountMetadata(report.reachablePaths.length, groupedPaths.length),
    architecture: getClusteredArchitectureProjection(report),
    evidence,
    evidenceCount: getCountMetadata(report.issues.reduce((total, issue) => total + issue.evidence.length, 0), evidence.length),
    nonProduction: {
      total: nonProductionIssues.length,
      byProvenance: nonProductionIssues.reduce((counts, issue) => {
        const provenance = issue.provenance || "unknown";
        counts[provenance] = (counts[provenance] || 0) + 1;
        return counts;
      }, {} as Record<RepositoryProvenance, number>),
      affectsVerdict: false,
      issues: nonProductionIssues.map((issue) => presentIssue(report, issue)),
    },
  };
}

export function buildPlaygroundMicroscopeViewModel({
  report,
  filePath,
  issueId,
  pathId,
  actionType,
}: {
  report: RepositoryExecutionReport;
  filePath?: string | null;
  issueId?: string | null;
  pathId?: string | null;
  actionType?: RepositorySensitiveAction | null;
}) {
  const selectedPath = pathId
    ? report.reachablePaths.find((path) => path.id === pathId)
    : undefined;
  const requestedFile = filePath ? normalizePath(report, filePath) : undefined;
  const knownFiles = new Set([
    ...report.impactedFiles.map((file) => normalizePath(report, file.path)),
    ...report.artifacts.map((artifact) => normalizePath(report, artifact.relativePath || artifact.filePath)),
    ...report.reachablePaths.flatMap((path) => path.files.map((file) => normalizePath(report, file))),
  ]);
  const safeRequestedFile = requestedFile && knownFiles.has(requestedFile) ? requestedFile : undefined;
  const selectedIssueCandidate = issueId
    ? report.issues.find((issue) =>
        issue.id === issueId &&
        (!safeRequestedFile || issue.impactedFiles.some((file) => normalizePath(report, file) === safeRequestedFile))
      ) || report.issues.find((issue) =>
        issue.ruleId === issueId &&
        (!safeRequestedFile || issue.impactedFiles.some((file) => normalizePath(report, file) === safeRequestedFile))
      )
    : undefined;
  const selectedFile = normalizePath(
    report,
    safeRequestedFile ||
      selectedIssueCandidate?.impactedFiles[0] ||
      selectedPath?.files[0] ||
      report.impactedFiles[0]?.path ||
      report.artifacts[0]?.relativePath ||
      "",
  );
  const fileIssues = report.issues
    .filter((issue) =>
      issue.impactedFiles.some((file) => normalizePath(report, file) === selectedFile),
    )
    .sort((a, b) =>
      RISK_RANK[b.severity] - RISK_RANK[a.severity] ||
      b.confidence.score - a.confidence.score ||
      a.ruleId.localeCompare(b.ruleId),
    )
    .map((issue) => presentIssue(report, issue));
  const issue = selectedIssueCandidate
    ? fileIssues.find((item) => item.id === selectedIssueCandidate.id) || null
    : fileIssues[0] || null;
  const issuePathIds = new Set(issue?.pathIds || []);
  const pathsSupportedByIssue = issue
    ? report.reachablePaths.filter((path) => issuePathIds.has(path.id)).sort(pathSort).map((path) => projectPath(report, path))
    : [];
  const fileRelatedPaths = report.reachablePaths
    .filter((path) => pathIncludesFile(report, path, selectedFile))
    .sort(pathSort)
    .map((path) => projectPath(report, path));
  const otherPathsInvolvingFile = fileRelatedPaths.filter((path) => !issuePathIds.has(path.id));
  const fileGraph = getFileGraphProjection(report, selectedFile);
  const issueGraph = issue ? getIssueGraphProjection(report, issue.id) : null;
  const graph = actionType
    ? getActionGraphProjection(report, actionType)
    : selectedPath
      ? graphProjection(
          report,
          (path) => path.id === selectedPath.id,
          (node) => safeRequestedFile
            ? normalizePath(report, node.relativePath || node.filePath || "") === selectedFile
            : selectedPath.nodeIds.includes(node.id),
        )
      : pathsSupportedByIssue.length > 0 && issueGraph
        ? issueGraph
        : fileGraph;
  const artifact = artifactForFile(report, selectedFile);
  const file = buildFileProjections(report).find((item) => item.path === selectedFile);
  const issueIndex = issue ? fileIssues.findIndex((item) => item.id === issue.id) : -1;

  return {
    selectedFile,
    selectedFileLabel: formatDistinctPathLabel(selectedFile, report.impactedFiles.map((fileItem) => normalizePath(report, fileItem.path))),
    artifactType: artifact?.type || file?.artifactType || "Other",
    provenance: artifact?.provenance || file?.provenance || "unknown",
    fileFindingSeverity: file?.fileFindingSeverity || issue?.severity || "none",
    highestRelatedPathRisk: file?.highestPathRisk || fileRelatedPaths[0]?.risk || "none",
    relatedPathCount: fileRelatedPaths.length,
    issueCount: fileIssues.length,
    issueCountMeta: getCountMetadata(fileIssues.length),
    issues: fileIssues,
    issue,
    issueIndex,
    previousIssue: issueIndex > 0 ? fileIssues[issueIndex - 1] : null,
    nextIssue: issueIndex >= 0 && issueIndex < fileIssues.length - 1 ? fileIssues[issueIndex + 1] : null,
    evidence: issue?.evidence || [],
    evidenceCount: getCountMetadata(issue?.evidence.length || 0),
    graph,
    pathsSupportedByIssue,
    pathsSupportedByIssueCount: getCountMetadata(pathsSupportedByIssue.length),
    otherPathsInvolvingFile,
    otherPathsInvolvingFileCount: getCountMetadata(otherPathsInvolvingFile.length),
    relatedPaths: [...pathsSupportedByIssue, ...otherPathsInvolvingFile],
    whyItMatters: issue?.whyThisMatters || issue?.impact || fileRelatedPaths[0]?.explanation || "",
    fix: issue ? {
      quickFix: issue.quickFix,
      recommendedFix: issue.recommendedFix,
      safePattern: issue.safePattern,
      effort: issue.effort,
      expectedEffect: issue.impact,
    } : null,
  };
}
