import { contextualVerdictLabel } from "@promptsonar/core/dist/contextual/presentation";
import type {
  ReachableExecutionPath,
  RepositoryArtifact,
  RepositoryArtifactType,
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

export type ArtifactKind =
  | "prompt"
  | "file"
  | "agent"
  | "mcp"
  | "skill"
  | "workflow"
  | "memory"
  | "tool"
  | "repository";

export type InvestigationSource =
  | {
      mode: "single-input";
      artifactKind: ArtifactKind;
      input: string;
      filename?: string;
    }
  | {
      mode: "repository";
      scanId: string;
      artifactId?: string;
      filePath?: string;
      issueId?: string;
      pathId?: string;
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
  context?: RepositoryExecutionIssue["context"];
  contextualVerdict: string;
  contextualVerdictLabel: string;
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
  artifactId?: string;
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

export type FindingGroup = {
  id: string;
  title: string;
  ruleId: string;
  severity: RepositoryExecutionIssue["severity"];
  confidence: RepositoryPathConfidence;
  issueCount: number;
  evidenceCount: number;
  issues: IssuePresentation[];
};

export type RelatedArtifact = {
  id: string;
  kind: ArtifactKind;
  name: string;
  repositoryRelativePath?: string;
  relationship: string;
  confidence: RepositoryPathConfidence;
};

export type SensitiveActionSummary = {
  action: RepositorySensitiveAction;
  confidence: RepositoryPathConfidence;
  supportingPathId: string;
  evidence: string;
};

export type PresentedRemediation = {
  quickFix: string;
  recommendedFix: string;
  safePattern: string;
  effort: RepositoryExecutionIssue["fix"]["effort"] | "Larger change";
  expectedEffect: string;
};

export type ArtifactInvestigationViewModel = {
  artifact: {
    id: string;
    kind: ArtifactKind;
    name: string;
    repositoryRelativePath?: string;
    provenance?: RepositoryProvenance;
    role?: string;
    metadata?: RepositoryArtifact["metadata"];
  };
  source: InvestigationSource["mode"];
  repositoryWiringAvailable: boolean;
  summary: {
    findingCount: number;
    executionPathCount: number;
    highestFindingSeverity?: RepositoryExecutionIssue["severity"] | "none";
    highestPathRisk?: RepositoryRisk | "none";
    findingConfidence?: RepositoryPathConfidence;
  };
  findingGroups: FindingGroup[];
  selectedFinding?: IssuePresentation | null;
  evidence: PresentedEvidence[];
  remediation?: PresentedRemediation | null;
  linkedPathFamilies: PathProjection[];
  otherPathFamilies: PathProjection[];
  focusedGraph: FocusedGraphProjection;
  upstream: RelatedArtifact[];
  downstream: RelatedArtifact[];
  sensitiveActions: SensitiveActionSummary[];
  countMetadata: {
    findings: CountMetadata;
    paths: CountMetadata;
    evidence: CountMetadata;
  };
};

export type PlaygroundMicroscopeViewModel = ArtifactInvestigationViewModel & {
  selectedFile: string;
  selectedFileLabel: string;
  artifactType: string;
  provenance: RepositoryProvenance;
  fileFindingSeverity: RepositoryExecutionIssue["severity"] | "none";
  highestRelatedPathRisk: RepositoryRisk | "none";
  relatedPathCount: number;
  issueCount: number;
  issueCountMeta: CountMetadata;
  issues: IssuePresentation[];
  issue: IssuePresentation | null;
  issueIndex: number;
  previousIssue: IssuePresentation | null;
  nextIssue: IssuePresentation | null;
  evidence: PresentedEvidence[];
  evidenceCount: CountMetadata;
  graph: FocusedGraphProjection;
  pathsSupportedByIssue: PathProjection[];
  pathsSupportedByIssueCount: CountMetadata;
  otherPathsInvolvingFile: PathProjection[];
  otherPathsInvolvingFileCount: CountMetadata;
  relatedPaths: PathProjection[];
  whyItMatters: string;
  fix: PresentedRemediation | null;
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

function artifactKindFromRepositoryType(type?: RepositoryArtifactType | string): ArtifactKind {
  const mapping: Record<string, ArtifactKind> = {
    PROMPT: "prompt",
    SKILL: "skill",
    MCP_SERVER: "mcp",
    AGENT_CONFIG: "agent",
    MEMORY: "memory",
    TOOL: "tool",
    WORKFLOW: "workflow",
    ACTION: "tool",
  };
  return mapping[String(type || "").toUpperCase()] || "file";
}

function artifactKindLabel(kind: ArtifactKind): string {
  const labels: Record<ArtifactKind, string> = {
    prompt: "Prompt",
    file: "File",
    agent: "Agent instructions",
    mcp: "MCP configuration",
    skill: "Skill",
    workflow: "Workflow",
    memory: "Memory",
    tool: "Tool router",
    repository: "Repository",
  };
  return labels[kind];
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
    context: issue.context,
    contextualVerdict: issue.context?.verdict || "uncontextualized",
    contextualVerdictLabel: contextualVerdictLabel(issue.context?.verdict),
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

function artifactForFocus(
  report: RepositoryExecutionReport,
  artifactId?: string | null,
  filePath?: string | null,
): RepositoryArtifact | undefined {
  if (artifactId) {
    const byId = report.artifacts.find((artifact) => artifact.id === artifactId);
    if (byId) return byId;
  }
  return filePath ? artifactForFile(report, filePath) : undefined;
}

function artifactPath(report: RepositoryExecutionReport, artifact?: RepositoryArtifact): string {
  return artifact ? normalizePath(report, artifact.relativePath || artifact.filePath || artifact.name) : "";
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
      artifactId: artifact?.id,
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

// The current (vulnerable) code shown on the "before" side of a remediation
// diff. Only direct evidence carries a real snippet; absence findings describe
// a missing requirement instead, so we surface that as the before text.
function currentPatternForIssue(issue: IssuePresentation): string | null {
  const direct = issue.evidence.find((item) => item.kind === "direct" && item.snippet);
  if (direct && direct.kind === "direct") return direct.snippet;
  const absence = issue.evidence.find((item) => item.kind === "absence");
  if (absence && absence.kind === "absence") return `Missing: ${absence.missingRequirement}`;
  return null;
}

// Plain-language consequence cards, derived from the sensitive actions that the
// scanned paths can actually reach (never fabricated). Highest-risk action
// first; deduplicated and path-weighted.
function buildBusinessImpact(
  highestRiskPath: PathProjection | null,
  otherActions: Array<{ action: RepositorySensitiveAction; count: number }>,
): Array<{ title: string; description: string }> {
  const counts = new Map<RepositorySensitiveAction, number>();
  if (highestRiskPath?.action) counts.set(highestRiskPath.action, highestRiskPath.instanceCount || 1);
  for (const { action, count } of otherActions) {
    counts.set(action, (counts.get(action) || 0) + count);
  }
  return Array.from(counts.entries()).map(([action, count]) => ({
    title: `${count.toLocaleString()} path${count === 1 ? "" : "s"} can reach ${action}`,
    description: actionImpact(action),
  }));
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
      before: currentPatternForIssue(nextIssue),
      after: nextIssue.safePattern || null,
    } : null,
    businessImpact: buildBusinessImpact(highestRiskPath, otherActions),
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
      currentPattern: currentPatternForIssue(issue),
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

function relatedArtifactsForGraph(
  report: RepositoryExecutionReport,
  graph: FocusedGraphProjection,
  artifactId: string,
) {
  const selected = new Set(graph.selectedNodeIds);
  const nodeById = new Map(report.executionMap.nodes.map((node) => [node.id, node]));
  const toRelated = (edge: RepositoryExecutionEdge, direction: "upstream" | "downstream"): RelatedArtifact | null => {
    const relatedNodeId = direction === "upstream" ? edge.from : edge.to;
    const node = nodeById.get(relatedNodeId);
    if (!node) return null;
    const artifact = node.artifactId
      ? report.artifacts.find((item) => item.id === node.artifactId)
      : artifactForFile(report, node.relativePath || node.filePath || "");
    return {
      id: artifact?.id || node.id,
      kind: artifactKindFromRepositoryType(artifact?.type || node.type),
      name: artifact?.name || node.label,
      repositoryRelativePath: artifact ? artifactPath(report, artifact) : normalizePath(report, node.relativePath || node.filePath || ""),
      relationship: relationshipLabel(edge),
      confidence: confidenceFromLabel(edge.confidenceLabel),
    };
  };
  const upstream = graph.edges
    .filter((edge) => selected.has(edge.to) && edge.from !== artifactId)
    .map((edge) => toRelated(edge, "upstream"))
    .filter((item): item is RelatedArtifact => Boolean(item));
  const downstream = graph.edges
    .filter((edge) => selected.has(edge.from) && edge.to !== artifactId)
    .map((edge) => toRelated(edge, "downstream"))
    .filter((item): item is RelatedArtifact => Boolean(item));
  return { upstream, downstream };
}

export function groupArtifactFindings(issues: IssuePresentation[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const issue of issues) {
    const existing = groups.get(issue.ruleId);
    if (existing) {
      existing.issueCount += 1;
      existing.evidenceCount += issue.evidence.length;
      existing.issues.push(issue);
      if (RISK_RANK[issue.severity] > RISK_RANK[existing.severity]) existing.severity = issue.severity;
      if (CONFIDENCE_RANK[issue.confidence.level] > CONFIDENCE_RANK[existing.confidence]) existing.confidence = issue.confidence.level;
    } else {
      groups.set(issue.ruleId, {
        id: issue.ruleId,
        title: issue.issue,
        ruleId: issue.ruleId,
        severity: issue.severity,
        confidence: issue.confidence.level,
        issueCount: 1,
        evidenceCount: issue.evidence.length,
        issues: [issue],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    RISK_RANK[b.severity] - RISK_RANK[a.severity] ||
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    a.title.localeCompare(b.title),
  );
}

export function groupArtifactPathFamilies(paths: PathProjection[]): PathProjection[] {
  return groupPathProjections(paths);
}

function buildSensitiveActionSummaries(paths: PathProjection[]): SensitiveActionSummary[] {
  const byAction = new Map<RepositorySensitiveAction, SensitiveActionSummary>();
  for (const path of paths) {
    if (!path.action) continue;
    const existing = byAction.get(path.action);
    if (existing && CONFIDENCE_RANK[existing.confidence] >= CONFIDENCE_RANK[path.confidence]) continue;
    byAction.set(path.action, {
      action: path.action,
      confidence: path.confidence,
      supportingPathId: path.id,
      evidence: path.edgePresentations.find((edge) => edge.evidence)?.evidence || path.explanation,
    });
  }
  return Array.from(byAction.values());
}

export function validateArtifactInvestigationViewModel(view: ArtifactInvestigationViewModel): void {
  const selectedPathIds = new Set(view.linkedPathFamilies.flatMap((path) => path.instanceIds));
  if (view.selectedFinding) {
    validateIssuePresentation(view.selectedFinding);
    const issuePathIds = new Set(view.selectedFinding.pathIds);
    for (const pathId of selectedPathIds) {
      if (!issuePathIds.has(pathId)) {
        throw new Error(`Linked path ${pathId} is not explicitly attached to selected finding ${view.selectedFinding.id}.`);
      }
    }
  }
  const artifactPathValue = view.artifact.repositoryRelativePath;
  for (const path of view.otherPathFamilies) {
    if (artifactPathValue && !path.files.includes(artifactPathValue)) {
      throw new Error(`Other path ${path.id} does not include selected artifact ${artifactPathValue}.`);
    }
  }
  if (!view.repositoryWiringAvailable) {
    if (view.upstream.length > 0 || view.downstream.length > 0 || view.otherPathFamilies.length > 0) {
      throw new Error("Single-input artifact model exposed repository-only relationships.");
    }
  }
}

export function buildArtifactInvestigationViewModel({
  report,
  source,
  artifactId,
  filePath,
  issueId,
  pathId,
  actionType,
}: {
  report: RepositoryExecutionReport;
  source?: InvestigationSource["mode"];
  artifactId?: string | null;
  filePath?: string | null;
  issueId?: string | null;
  pathId?: string | null;
  actionType?: RepositorySensitiveAction | null;
}): PlaygroundMicroscopeViewModel {
  const selectedPath = pathId
    ? report.reachablePaths.find((path) => path.id === pathId)
    : undefined;
  const requestedArtifact = artifactForFocus(report, artifactId, filePath);
  const requestedFile = filePath ? normalizePath(report, filePath) : artifactPath(report, requestedArtifact) || undefined;
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
  const selectedArtifact = artifactForFocus(report, artifactId, selectedFile) || artifactForFile(report, selectedFile);
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
  const sourceMode = source || (report.repository.root === "/playground" ? "single-input" : "repository");
  const repositoryWiringAvailable = sourceMode === "repository" && report.reachablePaths.length > 0;
  const groupedLinkedPaths = groupArtifactPathFamilies(pathsSupportedByIssue);
  const groupedOtherPaths = sourceMode === "single-input" ? [] : groupArtifactPathFamilies(otherPathsInvolvingFile);
  const related = sourceMode === "single-input"
    ? { upstream: [], downstream: [] }
    : relatedArtifactsForGraph(report, graph, selectedArtifact?.id || "");
  const artifactKind = artifactKindFromRepositoryType(selectedArtifact?.type || artifact?.type || file?.artifactType);
  const artifactName = selectedArtifact?.name || selectedFile || artifactKindLabel(artifactKind);
  const highestFindingSeverity = file?.fileFindingSeverity || issue?.severity || "none";
  const highestConfidence = fileIssues
    .map((item) => item.confidence.level)
    .sort((a, b) => CONFIDENCE_RANK[b] - CONFIDENCE_RANK[a])[0];
  const legacy = buildLegacyMicroscopeFields({
    selectedFile,
    selectedFileLabel: formatDistinctPathLabel(selectedFile, report.impactedFiles.map((fileItem) => normalizePath(report, fileItem.path))),
    artifactType: selectedArtifact?.type || artifact?.type || file?.artifactType || "Other",
    provenance: selectedArtifact?.provenance || artifact?.provenance || file?.provenance || "unknown",
    fileFindingSeverity: highestFindingSeverity,
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
    pathsSupportedByIssue: groupedLinkedPaths,
    pathsSupportedByIssueCount: getCountMetadata(pathsSupportedByIssue.length, groupedLinkedPaths.length),
    otherPathsInvolvingFile: groupedOtherPaths,
    otherPathsInvolvingFileCount: getCountMetadata(otherPathsInvolvingFile.length, groupedOtherPaths.length),
    relatedPaths: [...groupedLinkedPaths, ...groupedOtherPaths],
    whyItMatters: issue?.whyThisMatters || issue?.impact || fileRelatedPaths[0]?.explanation || "",
    fix: issue ? {
      quickFix: issue.quickFix,
      recommendedFix: issue.recommendedFix,
      safePattern: issue.safePattern,
      effort: issue.effort,
      expectedEffect: issue.impact,
    } : null,
  });

  const view: PlaygroundMicroscopeViewModel = {
    ...legacy,
    artifact: {
      id: selectedArtifact?.id || stableArtifactId(selectedFile || artifactName),
      kind: artifactKind,
      name: artifactName,
      repositoryRelativePath: selectedFile || undefined,
      provenance: selectedArtifact?.provenance || artifact?.provenance || file?.provenance,
      role: file?.role || roleForFile(fileRelatedPaths[0] || null, selectedFile),
      metadata: selectedArtifact?.metadata || artifact?.metadata,
    },
    source: sourceMode,
    repositoryWiringAvailable,
    summary: {
      findingCount: fileIssues.length,
      executionPathCount: sourceMode === "single-input" ? 0 : fileRelatedPaths.length,
      highestFindingSeverity,
      highestPathRisk: sourceMode === "single-input" ? "none" : legacy.highestRelatedPathRisk,
      findingConfidence: highestConfidence,
    },
    findingGroups: groupArtifactFindings(fileIssues),
    selectedFinding: issue,
    evidence: issue?.evidence || [],
    remediation: legacy.fix,
    linkedPathFamilies: groupedLinkedPaths,
    otherPathFamilies: groupedOtherPaths,
    focusedGraph: graph,
    upstream: related.upstream,
    downstream: related.downstream,
    sensitiveActions: sourceMode === "single-input" ? [] : buildSensitiveActionSummaries([...groupedLinkedPaths, ...groupedOtherPaths]),
    countMetadata: {
      findings: getCountMetadata(fileIssues.length),
      paths: getCountMetadata(fileRelatedPaths.length, groupedLinkedPaths.length + groupedOtherPaths.length),
      evidence: getCountMetadata(issue?.evidence.length || 0),
    },
  };

  if (process.env.NODE_ENV !== "production") validateArtifactInvestigationViewModel(view);
  return view;
}

function stableArtifactId(value: string): string {
  return `artifact:${value.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "selected"}`;
}

function buildLegacyMicroscopeFields<T>(fields: T): T {
  return fields;
}

export function buildPlaygroundMicroscopeViewModel(args: Parameters<typeof buildArtifactInvestigationViewModel>[0]) {
  return buildArtifactInvestigationViewModel(args);
}

export function buildRepositoryArtifactInvestigationViewModel(args: Omit<Parameters<typeof buildArtifactInvestigationViewModel>[0], "source">) {
  return buildArtifactInvestigationViewModel({ ...args, source: "repository" });
}

export function buildSinglePromptInvestigationViewModel(report: RepositoryExecutionReport, issueId?: string | null) {
  return buildArtifactInvestigationViewModel({ report, source: "single-input", issueId, filePath: report.artifacts[0]?.relativePath || "playground.prompt" });
}

export function buildSingleFileInvestigationViewModel(report: RepositoryExecutionReport, filePath?: string | null, issueId?: string | null) {
  return buildArtifactInvestigationViewModel({ report, source: "single-input", filePath: filePath || report.artifacts[0]?.relativePath, issueId });
}

export function buildFocusedArtifactGraph(report: RepositoryExecutionReport, filePath: string, limit = 18) {
  return getFileGraphProjection(report, filePath, limit);
}
