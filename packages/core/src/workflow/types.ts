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
