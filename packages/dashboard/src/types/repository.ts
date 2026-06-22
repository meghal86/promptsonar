// types/repository.ts
// Repository Explorer v2 — data contract.

export type Confidence = "confirmed" | "probable" | "potential";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Provenance =
  | "production"
  | "configuration"
  | "documentation"
  | "test"
  | "fixture";

export interface RepositoryScan {
  id: string;
  name: string;
  scanMode: "device" | "github" | "cli";
  scannedAt: string;
  verdict: {
    overallRisk: Severity;
    trustStatus: "review-required" | "pass" | "fail";
    highestPathConfidence: Confidence;
    summaryLine: string; // "A path can reach your filesystem..."
    confirmedSummary: string; // "wildcard permission + auto-approval"
    inferredSummary: string; // "prompt → router → MCP routing"
  };
  coverage: {
    considered: number;
    scanned: number;
    skipped: number;
    productionArtifacts: number;
    skippedBreakdown: {
      generated: number;
      unsupported: number;
      binary: number;
      oversized: number;
    };
  };
  findings: { confirmed: number; probable: number; potential: number };
  riskScore: number; // 0-100
  nextAction: {
    file: string;
    effort: string;
    issueTitle: string;
    before: string; // raw code string
    after: string; // raw code string
  };
  businessImpact: Array<{ title: string; description: string }>;
  highestRiskPath: ExecutionPath;
  files: AffectedFile[];
  remediation: RemediationStep[];
  evidence: EvidenceRecord[];
  nonProductionFindings: NonProdGroup[];
  paths: ExecutionPath[];
  graph: GraphData;
}

export interface ExecutionPath {
  id: string;
  nodes: PathNode[]; // ordered, source to sink
  severity: Severity;
  confidence: Confidence;
  fileCount: number;
  confirmedFacts: string;
  inferred: string;
  filesInvolved: string[];
  otherSensitiveActions?: Array<{ action: string; pathCount: number }>;
}

export interface PathNode {
  id: string;
  type:
    | "prompt"
    | "skill"
    | "workflow"
    | "tool-router"
    | "mcp-server"
    | "memory"
    | "doc"
    | "action";
  name: string;
  isSink: boolean;
  edgeLabel?: string; // edge AFTER this node: 'confirmed' | 'probable' | 'potential'
}

export interface AffectedFile {
  path: string;
  provenance: Provenance;
  artifactType: string; // 'MCP config', 'Prompt', 'Skill', etc.
  description: string; // one short phrase, no sentence
  pathRisk: Severity;
  fileFinding: Severity;
  issueCount: number;
  pathCount: number;
}

export interface RemediationStep {
  order: number;
  title: string;
  codeHint: string; // short mono snippet, e.g. '"permissions": ["filesystem.read"]'
  fileHint: string; // file it belongs in
  impact: "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
}

export interface EvidenceRecord {
  file: string;
  line: number;
  snippet: string;
  rule: string;
  confidence: Confidence;
}

export interface NonProdGroup {
  count: number;
  label: string;
  note: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  type: PathNode["type"];
  name: string;
  col: 0 | 1 | 2; // left=sources, center=routing, right=sinks
  row: number; // 0-4
  isSink: boolean;
  isHot: boolean; // part of highest-risk path
}

export interface GraphEdge {
  from: string;
  to: string;
  isConfirmedRoute: boolean;
}
