import type { Finding, Severity } from '../rules/types';
import type { McpAuditResult, McpFinding, McpRiskScore } from '../mcp';
import type { FindingWorkflow, RootCauseAnalysis, WorkflowDiff, WorkflowEvidence } from '../workflow';

export type RuntimeDecision = 'ALLOW' | 'WARN' | 'BLOCK';
export type ExecutionVerdict = 'SAFE' | 'REVIEW' | 'DANGEROUS';

export type RuntimeToolType =
    | 'shell'
    | 'filesystem'
    | 'network'
    | 'memory'
    | 'mcp'
    | 'browser'
    | 'database'
    | 'unknown';

/** A host-provided tool definition used for deterministic pre-execution risk review. */
export interface RuntimeToolDefinition {
    name: string;
    type?: RuntimeToolType | string;
    description?: string;
    permissions?: string[];
    executionMode?: 'auto' | 'manual' | 'approval_required' | 'unknown' | string;
    approvalRequired?: boolean;
    inputSchema?: unknown;
    metadata?: Record<string, unknown>;
}

/** A host-provided MCP server definition. `config` may be a raw config object or JSON string. */
export interface RuntimeMcpDefinition {
    name?: string;
    config: unknown;
}

/** Runtime memory settings reviewed for persistence, cross-session scope, and unbounded writes. */
export interface RuntimeMemoryConfiguration {
    enabled?: boolean;
    persistent?: boolean;
    crossSession?: boolean;
    bounded?: boolean;
    maxEntries?: number;
    writePolicy?: 'none' | 'approval_required' | 'automatic' | string;
    description?: string;
}

/** The specific tool, MCP call, memory action, or other operation an agent plans to execute. */
export interface RuntimeOperation {
    kind: RuntimeToolType | string;
    toolName?: string;
    serverName?: string;
    description?: string;
    args?: unknown;
    approvalRequired?: boolean;
}

/** Runtime policy controls for converting verdicts and findings into ALLOW/WARN/BLOCK decisions. */
export interface RuntimePolicyConfig {
    block_on?: Array<Severity | 'privileged_sink' | 'mcp_critical' | 'dangerous_tool' | 'memory_persistence'>;
    warn_on?: Array<Severity | 'privileged_sink' | 'mcp_high' | 'dangerous_tool' | 'memory_persistence'>;
    confidence_threshold?: number;
}

export interface RuntimeConfig {
    runtime?: RuntimePolicyConfig;
}

/** Per-tool risk evidence produced by `analyzeToolRisk()`. */
export interface ToolRiskSummaryItem {
    tool: string;
    type: RuntimeToolType | string;
    risk: ExecutionVerdict;
    riskScore: number;
    decision: RuntimeDecision;
    privileged: boolean;
    approvalRequired: boolean;
    evidence: string[];
}

/** Aggregate tool risk summary for all active tools. */
export interface ToolRiskSummary {
    tools: ToolRiskSummaryItem[];
    highestRisk: ExecutionVerdict;
    privilegedToolCount: number;
}

/** Memory risk summary produced by `analyzeMemoryConfiguration()`. */
export interface MemoryRiskSummary {
    enabled: boolean;
    persistent: boolean;
    crossSession: boolean;
    unboundedWrites: boolean;
    decision: RuntimeDecision;
    riskScore: number;
    evidence: string[];
}

/** MCP runtime review produced by `reviewMcpRuntime()`. */
export interface McpRuntimeReview {
    decision: RuntimeDecision;
    verdict: ExecutionVerdict;
    riskScore?: McpRiskScore;
    audits: McpAuditResult[];
    findings: McpFinding[];
    evidence: string[];
}

/** Deterministic workflow confidence and provenance exposed on runtime reports. */
export interface RuntimeProvenance {
    confidenceScore: number;
    confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    evidence: WorkflowEvidence[];
    labels: string[];
}

/** Input contract for `analyzeExecutionPath()`. */
export interface ExecutionPathAnalysisInput {
    prompt: string;
    systemPrompt?: string;
    toolDefinitions?: RuntimeToolDefinition[];
    mcpDefinitions?: RuntimeMcpDefinition[];
    memoryConfiguration?: RuntimeMemoryConfiguration;
    operation?: RuntimeOperation;
    config?: RuntimeConfig;
    filePath?: string;
}

/** Machine-readable runtime report returned before agent tool execution. */
export interface ExecutionPathAnalysisResult {
    decision: RuntimeDecision;
    executionVerdict: ExecutionVerdict;
    riskScore: number;
    findings: Finding[];
    workflow?: FindingWorkflow;
    confidence: RuntimeProvenance;
    provenance: RuntimeProvenance;
    rootCause?: RootCauseAnalysis;
    workflowDiff?: WorkflowDiff;
    toolRiskSummary: ToolRiskSummary;
    memoryRiskSummary: MemoryRiskSummary;
    mcpRuntimeReview: McpRuntimeReview;
    evidence: string[];
}

/** Generic adapter input shared by Cursor, Claude Code, Codex, Windsurf, and other agent hosts. */
export interface AgentRuntimeAdapterInput {
    activePrompt: string;
    systemPrompt?: string;
    activeTools?: RuntimeToolDefinition[];
    activeMcpServers?: RuntimeMcpDefinition[];
    memoryConfiguration?: RuntimeMemoryConfiguration;
    operation?: RuntimeOperation;
    config?: RuntimeConfig;
}

/** Options for `createPromptSonarMiddleware()`. */
export interface PromptSonarMiddlewareOptions {
    config?: RuntimeConfig;
    onReview?: (result: ExecutionPathAnalysisResult) => void;
    onWarn?: (result: ExecutionPathAnalysisResult) => void;
    onBlock?: (result: ExecutionPathAnalysisResult) => void;
}

/** Middleware request reviewed by `beforeExecution()`. */
export interface PromptSonarMiddlewareRequest extends AgentRuntimeAdapterInput {
    mcpCall?: RuntimeOperation;
}
