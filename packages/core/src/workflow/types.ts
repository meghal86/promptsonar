import type { Severity } from '../rules/types';

export type WorkflowNodeType =
    | 'user_input'
    | 'untrusted_content'
    | 'system_prompt'
    | 'developer_prompt'
    | 'prompt_template'
    | 'agent_memory'
    | 'retrieved_context'
    | 'rag_context'
    | 'mcp_server'
    | 'mcp_tool'
    | 'privileged_tool'
    | 'tool_router'
    | 'tool_execution'
    | 'shell_execution'
    | 'network_access'
    | 'filesystem_access'
    | 'credential_store'
    | 'external_api'
    | 'policy_override'
    | 'secret'
    // Hardened-path node types used by the workflow diff engine to model the
    // benign "after" execution path (USER INPUT -> MODEL -> RESPONSE).
    | 'model'
    | 'response'
    | 'unknown';

export type WorkflowTrust = 'trusted' | 'semi_trusted' | 'untrusted' | 'privileged' | 'unknown';
export type WorkflowConfidence = 'low' | 'medium' | 'high';

// Deterministic confidence level for an inferred execution path (Feature 2).
export type WorkflowConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

// A single piece of supporting evidence for a workflow path. Every item is
// derived from an actual scanner finding / rule match — never generated text.
export interface WorkflowEvidence {
    id: string;
    ruleId: string;
    label: string;
    severity: Severity;
    source: string;
}

// Per-node provenance: why a node exists in the path, what it contributes to the
// confidence score, and which deterministic indicators (rule matches) produced it.
export interface NodeProvenance {
    evidence: WorkflowEvidence[];
    confidenceContribution: number;
    ruleMatches: string[];
}

export type WorkflowEdgeType =
    | 'data_flow'
    | 'instruction_flow'
    | 'retrieval_flow'
    | 'memory_flow'
    | 'tool_call'
    | 'permission_flow'
    | 'trust_boundary'
    | 'execution_flow';

export type WorkflowRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface WorkflowSourceLocation {
    filePath: string;
    line?: number;
    column?: number;
}

export interface WorkflowNode {
    id: string;
    label: string;
    type: WorkflowNodeType;
    trust: WorkflowTrust;
    confidence?: WorkflowConfidence;
    reason?: string;
    evidence?: string;
    inferredBy?: string[];
    tainted?: boolean;
    privilegePropagated?: boolean;
    sourceLocation?: WorkflowSourceLocation;
    provenance?: NodeProvenance;
}

export interface WorkflowEdge {
    from: string;
    to: string;
    type: WorkflowEdgeType;
    risk: WorkflowRisk;
    reason: string;
    confidence?: WorkflowConfidence;
    tainted?: boolean;
    privilegePropagated?: boolean;
}

export interface WorkflowPath {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    summary: string;
    risk: WorkflowRisk;
    trustBoundaryCrossed: boolean;
    privilegedSinkReached: boolean;
    recommendation: string;
    confidence?: WorkflowConfidence;
    explanation?: string[];
    riskStory?: string;
    severityReason?: string;
    // Deterministic provenance layer (Features 1, 2, 4).
    confidence_score?: number;
    confidence_level?: WorkflowConfidenceLevel;
    workflow_evidence?: string[];
    evidence?: WorkflowEvidence[];
    // Workflow Diff Engine (remediation before/after). Present only when the
    // path reaches a privileged sink. Additive — existing consumers ignore it.
    workflow_diff?: WorkflowDiff;
}

// ---------------------------------------------------------------------------
// Workflow Diff Engine
//
// Structurally represents how an execution path changes after remediation:
// the dangerous "before" graph, the hardened "after" graph, exactly which
// nodes/edges were removed, and a deterministic risk-reduction percentage.
// No AI, no randomness — every value is derived from the graphs themselves.
// ---------------------------------------------------------------------------

export interface WorkflowGraph {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    risk: WorkflowRisk;
    // Deterministic 0–100 risk magnitude for this graph.
    riskScore: number;
    privilegedSinkReached: boolean;
    trustBoundaryCrossed: boolean;
}

export interface WorkflowDiffComparison {
    nodes: { removed: string[]; added: string[] };
    edges: { removed: string[]; added: string[] };
    privilegedSinks: { removed: string[]; added: string[] };
    trustBoundaries: { before: boolean; after: boolean; removed: boolean };
    permissions: { removed: string[]; added: string[] };
}

// Machine-readable classification of *why* the workflow changed. Enables future
// analytics/reporting (benchmark suite, PR review) without re-deriving intent.
export type WorkflowDiffReason =
    | 'privileged_sink_removed'   // a privileged sink existed before and none remains after
    | 'trust_boundary_removed'    // an untrusted/unknown boundary node (e.g. mcp_server) was removed
    | 'routing_surface_removed'   // the tool-routing surface was removed but a sink may remain
    | 'partial_remediation'       // a sink was removed but at least one privileged sink remains
    | 'no_change';                // nothing structural changed

export interface WorkflowDiff {
    // Schema version of the diff contract. Bump when the shape changes so that
    // consumers (SARIF, dashboard, future replay/benchmark tooling) can adapt
    // without breaking on older payloads. Current: "1.0".
    workflowDiffVersion: string;
    before: WorkflowGraph;
    after: WorkflowGraph;
    removedNodes: string[];
    addedNodes: string[];
    removedEdges: string[];
    addedEdges: string[];
    // (beforeRisk - afterRisk) / beforeRisk, expressed as 0–100.
    riskReduction: number;
    // Stable risk magnitudes that produced `riskReduction`. Part of the public
    // contract — future Workflow Replay / Benchmark / PR Review features consume
    // these directly, so they must remain present even when riskReduction is 0.
    beforeRisk: number;
    afterRisk: number;
    // True when a privileged sink existed in `before` and no longer exists in `after`.
    executionPathRemoved: boolean;
    // Why the diff looks the way it does (see WorkflowDiffReason).
    diffReason: WorkflowDiffReason;
    comparison: WorkflowDiffComparison;
}

export type WorkflowReplayEventType =
    | 'USER_INPUT'
    | 'SYSTEM_PROMPT'
    | 'MEMORY_READ'
    | 'MEMORY_WRITE'
    | 'TOOL_ROUTER'
    | 'MCP_SERVER'
    | 'MCP_TOOL'
    | 'NETWORK'
    | 'FILESYSTEM'
    | 'SHELL'
    | 'MODEL'
    | 'RESPONSE';

export type WorkflowReplayRiskVerdict = 'SAFE' | 'REVIEW' | 'DANGEROUS';

export interface WorkflowReplayEventEvidence {
    ruleId?: string;
    label: string;
    source?: string;
    severity?: Severity;
}

export interface WorkflowReplayEvent {
    index: number;
    timestamp: string;
    type: WorkflowReplayEventType;
    nodeId: string;
    nodeType: WorkflowNodeType;
    label: string;
    trust: WorkflowTrust;
    confidence: WorkflowConfidence;
    confidenceContribution: number;
    trustBoundaryCrossed: boolean;
    riskBefore: WorkflowReplayRiskVerdict;
    riskAfter: WorkflowReplayRiskVerdict;
    riskTransition: `${WorkflowReplayRiskVerdict}->${WorkflowReplayRiskVerdict}`;
    reason: string;
    matchedRules: string[];
    provenance: WorkflowReplayEventEvidence[];
}

export interface WorkflowReplay {
    replay_version: string;
    generated_from: 'workflow_graph';
    timeline: string[];
    risk_evolution: WorkflowReplayRiskVerdict[];
    events: WorkflowReplayEvent[];
}

export interface FindingWorkflow {
    path: WorkflowPath;
    source: WorkflowNodeType;
    sink: WorkflowNodeType;
    trustBoundary: string;
    risk: WorkflowRisk;
    recommendation: string;
    confidence?: WorkflowConfidence;
    explanation?: string[];
    // Deterministic provenance layer, mirrored at the workflow root so consumers
    // (SARIF, dashboard) can read it without reaching into `path`.
    confidence_score?: number;
    confidence_level?: WorkflowConfidenceLevel;
    workflow_evidence?: string[];
    evidence?: WorkflowEvidence[];
    // Workflow Diff Engine, mirrored at the root for SARIF/dashboard consumers.
    workflow_diff?: WorkflowDiff;
    // Workflow Replay Engine: deterministic event timeline derived from the
    // workflow graph and provenance. No generated text or LLM calls.
    workflow_replay?: WorkflowReplay;
}

// Root-cause grouping (Feature 3): the single finding that best explains a
// cluster, plus the related findings that describe the same underlying issue.
// No findings are deleted or suppressed — this is organization only.
export interface RootCauseAnalysis {
    rootCause: import('../rules/types').Finding;
    supportingFindings: import('../rules/types').Finding[];
}

export interface WorkflowInferenceInput {
    ruleId: string;
    severity: Severity;
    text: string;
    content?: string;
    filePath?: string;
    line?: number;
    column?: number;
    message?: string;
}
