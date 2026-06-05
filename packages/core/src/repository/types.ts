import type { Severity } from '../rules/types';

export type RepositoryArtifactType =
    | 'PROMPT'
    | 'SKILL'
    | 'MCP_SERVER'
    | 'AGENT_CONFIG'
    | 'MEMORY'
    | 'TOOL'
    | 'WORKFLOW'
    | 'ACTION';

export type RepositoryExecutionNodeType =
    | 'PROMPT'
    | 'SKILL'
    | 'MEMORY'
    | 'TOOL'
    | 'MCP_SERVER'
    | 'WORKFLOW'
    | 'ACTION';

export type RepositoryExecutionEdgeType =
    | 'REFERENCES'
    | 'INVOKES'
    | 'ROUTES_TO'
    | 'READS'
    | 'WRITES'
    | 'CAN_REACH';

export type RepositoryRisk = 'critical' | 'high' | 'medium' | 'low';
export type RepositoryTrustStatus = 'Trusted' | 'Review Required' | 'High Risk';
export type RepositorySensitiveAction = 'Shell' | 'Filesystem' | 'Network' | 'Secrets' | 'External APIs';
export type RepositoryPathConfidence = 'confirmed' | 'probable' | 'potential';

export interface RepositoryArtifact {
    id: string;
    type: RepositoryArtifactType;
    name: string;
    filePath: string;
    relativePath: string;
    description: string;
    evidence: string[];
    signals: string[];
    metadata?: {
        servers?: string[];
        tools?: string[];
        capabilities?: string[];
        constraints?: string[];
        permissions?: string[];
        autoApprove?: boolean;
        parseWarning?: string;
        sensitiveActions?: RepositorySensitiveAction[];
        references?: string[];
    };
}

export interface RepositoryExecutionNode {
    id: string;
    type: RepositoryExecutionNodeType;
    label: string;
    filePath?: string;
    relativePath?: string;
    artifactId?: string;
    description: string;
    metadata?: Record<string, unknown>;
}

export interface RepositoryExecutionEdge {
    id: string;
    from: string;
    to: string;
    type: RepositoryExecutionEdgeType;
    reason: string;
    evidence?: string;
    confidence: number;
}

export interface RepositoryExecutionGraphPath {
    id: string;
    nodeIds: string[];
    edgeIds: string[];
    risk: RepositoryRisk;
    explanation: string;
}

export interface RepositoryExecutionMap {
    nodes: RepositoryExecutionNode[];
    edges: RepositoryExecutionEdge[];
    paths: RepositoryExecutionGraphPath[];
}

export interface RepositoryScanFinding {
    rule_id: string;
    category?: string;
    severity: string;
    line?: number;
    column?: number;
    message?: string;
    fix?: string;
    recommendation?: string;
    evidence?: string;
    confidence?: string;
    waived?: boolean;
    workflow?: any;
}

export interface RepositoryScanResult {
    filePath: string;
    findings: RepositoryScanFinding[];
}

export interface ReachableExecutionPath {
    id: string;
    risk: RepositoryRisk;
    nodeIds: string[];
    edgeIds: string[];
    sensitiveActions: RepositorySensitiveAction[];
    evidence: Array<{
        filePath: string;
        ruleId?: string;
        severity?: Severity | string;
        message: string;
        line?: number;
        snippet?: string;
    }>;
    files: string[];
    confidence: number;
    confidenceLevel: RepositoryPathConfidence;
    explanation: string;
    findings: Array<{
        filePath: string;
        ruleId: string;
        severity: Severity | string;
        line?: number;
    }>;
}

export interface RepositorySummary {
    aiSurfacesFound: {
        prompts: number;
        skills: number;
        mcpServers: number;
        tools: number;
        workflows: number;
        memorySystems: number;
        agentConfigs: number;
    };
    executionGraph: {
        nodes: number;
        edges: number;
    };
    reachableSensitiveActions: Record<RepositorySensitiveAction, number>;
    riskSummary: Record<'critical' | 'high' | 'medium' | 'low', number>;
    confidenceSummary: Record<RepositoryPathConfidence, number>;
    trustStatus: RepositoryTrustStatus;
}

export interface RepositoryExecutionReport {
    version: string;
    generated_at: string;
    repository: {
        root: string;
        name: string;
    };
    artifacts: RepositoryArtifact[];
    executionMap: RepositoryExecutionMap;
    reachablePaths: ReachableExecutionPath[];
    summary: RepositorySummary;
    findings: RepositoryScanResult[];
}

export interface AnalyzeRepositoryOptions {
    maxFiles?: number;
    maxFileSizeBytes?: number;
}
