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
