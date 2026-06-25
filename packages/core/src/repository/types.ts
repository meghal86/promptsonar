import type { Severity } from '../rules/types';
import type { CanonicalAnalysisIssue, CanonicalIssueContext, CapabilityType } from '../contextual/types';
import type { ArtifactKind, ExecutionIntent } from '../artifacts';

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

// Where an artifact/finding lives in the repository. Only `production` artifacts
// drive repository trust status; documentation, tests, fixtures, and examples
// stay visible but are reported as non-production context, not live product risk.
export type RepositoryProvenance =
    | 'production'
    | 'documentation'
    | 'test'
    | 'fixture'
    | 'example'
    | 'generated'
    | 'unknown';

export const NON_PRODUCTION_PROVENANCE: ReadonlySet<RepositoryProvenance> = new Set<RepositoryProvenance>([
    'documentation',
    'test',
    'fixture',
    'example',
    'generated',
]);

export interface RepositoryArtifact {
    id: string;
    type: RepositoryArtifactType;
    name: string;
    filePath: string;
    relativePath: string;
    description: string;
    evidence: string[];
    confidence?: number;
    confidenceLabel?: 'Confirmed' | 'Probable' | 'Potential';
    evidenceRefs?: string[];
    provenance?: RepositoryProvenance;
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
    lineStart?: number;
    lineEnd?: number;
    confidence?: number;
    confidenceLabel?: 'Confirmed' | 'Probable' | 'Potential';
    evidenceRefs?: string[];
}

export interface RepositoryExecutionEdge {
    id: string;
    from: string;
    to: string;
    type: RepositoryExecutionEdgeType;
    reason: string;
    evidence?: string;
    evidenceRefs?: string[];
    confidence: number;
    confidenceLabel?: 'Confirmed' | 'Probable' | 'Potential';
    confidenceDefinition?: string;
    relationship?: RepositoryExecutionEdgeType;
    provenance?: 'direct' | 'connected' | 'structural';
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
    // True when path enumeration hit its cap and the path list is incomplete.
    pathsTruncated?: boolean;
    pathEnumerationLimit?: number;
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
    evidenceKind?: 'direct' | 'absence';
    scopeLabel?: string;
    missingRequirement?: string;
    scopeStartLine?: number;
    scopeEndLine?: number;
    confidence?: string;
    why?: string;
    risk?: string;
    waived?: boolean;
    workflow?: any;
    context?: CanonicalIssueContext;
    artifactKind?: ArtifactKind;
    executionIntent?: ExecutionIntent;
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
    sourceNodeId?: string;
    sinkNodeId?: string;
    sensitiveAction?: RepositorySensitiveAction;
    severity?: RepositoryRisk;
    evidenceRefs?: string[];
    evidence: Array<{
        id?: string;
        type?: string;
        filePath: string;
        ruleId?: string;
        severity?: Severity | string;
        message: string;
        line?: number;
        snippet?: string;
    }>;
    files: string[];
    provenance?: RepositoryProvenance;
    confidence: number;
    confidenceLevel: RepositoryPathConfidence;
    confidenceLabel?: 'Confirmed' | 'Probable' | 'Potential';
    confidenceDefinition?: string;
    explanation: string;
    findings: Array<{
        filePath: string;
        ruleId: string;
        severity: Severity | string;
        line?: number;
    }>;
}

export interface RepositoryScanStats {
    filesConsidered: number;
    filesScanned: number;
    filesSkipped: number;
    skipReasons: Record<string, number>;
    truncated: boolean;
}

export interface RepositorySummary {
    filesScanned?: number;
    artifactFiles?: number;
    scanStats?: RepositoryScanStats;
    pathValidationStatus?: 'passed' | 'failed';
    pathValidationErrors?: number;
    pathsTruncated?: boolean;
    aiSurfaces?: number;
    instructionSources?: number;
    skills?: number;
    mcpServers?: number;
    toolRouters?: number;
    workflows?: number;
    memorySystems?: number;
    sensitiveActions?: number;
    reachablePaths?: number;
    confirmedPaths?: number;
    probablePaths?: number;
    potentialPaths?: number;
    criticalFindings?: number;
    overallRisk?: RepositoryRisk | 'none';
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
    // Issue counts split by provenance so trust can be read against production
    // artifacts only, while documentation/test/fixture findings stay visible.
    productionIssueSummary?: RepositoryIssueSummary;
    nonProductionIssueSummary?: RepositoryIssueSummary;
    issuesByProvenance?: Record<RepositoryProvenance, number>;
}

export interface RepositoryExecutionIssueEvidence {
    id: string;
    ruleId?: string;
    file: string;
    line?: number;
    column?: number;
    snippet: string;
    kind?: 'direct' | 'absence';
    startLine?: number;
    endLine?: number;
    scopeLabel?: string;
    missingRequirement?: string;
    source: 'scanner' | 'workflow' | 'repository-graph';
}

export interface RepositoryExecutionIssueConfidence {
    score: number;
    level: RepositoryPathConfidence;
    label: 'Confirmed' | 'Probable' | 'Potential';
    definition: string;
}

export type RepositoryIssueFixEffort = 'Quick' | 'Moderate' | 'Large';

export interface RepositoryIssueFix {
    quickFix: string;
    recommendedFix: string;
    safePattern: string;
    effort: RepositoryIssueFixEffort;
}

export interface RepositoryExecutionIssue extends CanonicalAnalysisIssue {
    id: string;
    ruleId: string;
    severity: Severity | string;
    category: string;
    issue: string;
    impact: string;
    whyThisMatters: string;
    howToFix: string;
    fix: RepositoryIssueFix;
    evidence: RepositoryExecutionIssueEvidence[];
    confidence: RepositoryExecutionIssueConfidence;
    technicalDetails: {
        executionPath: string;
        evidence: RepositoryExecutionIssueEvidence[];
        confidence: RepositoryExecutionIssueConfidence;
    };
    impactedFiles: string[];
    fixSuggestions: string[];
    pathIds: string[];
    provenance?: RepositoryProvenance;
    context?: CanonicalIssueContext;
}

export interface RepositoryIssueSummary {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
}

export interface RepositoryExecutiveSummary {
    overallRisk: RepositoryRisk | 'none';
    findingCounts: RepositoryIssueSummary;
    highestPriorityFindings: Array<{
        id: string;
        ruleId: string;
        severity: Severity | string;
        issue: string;
        impactedFiles: string[];
    }>;
    estimatedFixEffort: RepositoryIssueFixEffort;
}

export type RepositoryImpactedFileType = 'SKILL.md' | 'MCP Config' | 'Workflow' | 'Prompt' | 'Other';

export interface RepositoryImpactedFile {
    path: string;
    name: string;
    type: RepositoryImpactedFileType;
    issueIds: string[];
    issueCount: number;
    highestSeverity: Severity | string;
    pathIds: string[];
}

export interface RepositoryPathValidationError {
    pathId?: string;
    code:
        | 'node-count-mismatch'
        | 'edge-count-mismatch'
        | 'reachable-path-count-mismatch'
        | 'unknown-node'
        | 'unknown-edge'
        | 'broken-chain'
        | 'invalid-source'
        | 'invalid-sensitive-action'
        | 'missing-evidence'
        | 'issue-count-mismatch'
        | 'impacted-file-count-mismatch'
        | 'evidence-owner-mismatch'
        | 'completeness-count-mismatch'
        | 'repository-complete-with-unresolved-context';
    message: string;
}

export interface RepositoryPathValidation {
    valid: boolean;
    checkedPaths: number;
    errors: RepositoryPathValidationError[];
}

export interface RepositoryExecutionReport {
    id?: string;
    version: string;
    schemaVersion: string;
    generated_at: string;
    scannedAt?: string;
    repository: {
        root: string;
        name: string;
    };
    scanMode?: 'local' | 'browser-bounded' | 'ci' | 'unknown';
    artifacts: RepositoryArtifact[];
    files?: RepositoryArtifact[];
    skills?: RepositoryArtifact[];
    mcpServers?: RepositoryArtifact[];
    workflows?: RepositoryArtifact[];
    evidence?: Array<{
        id: string;
        type: string;
        file: string;
        lineStart?: number;
        lineEnd?: number;
        snippet?: string;
        ruleId?: string;
        source: string;
        confidence: number;
        confidenceLabel: 'Confirmed' | 'Probable' | 'Potential';
    }>;
    fixPlan?: Array<{
        id: string;
        title: string;
        description: string;
        pathId?: string;
        artifactId?: string;
    }>;
    exports?: {
        json: boolean;
        sarif: boolean;
        html: boolean;
        mapJson: boolean;
    };
    executionMap: RepositoryExecutionMap;
    reachablePaths: ReachableExecutionPath[];
    summary: RepositorySummary;
    executiveSummary?: RepositoryExecutiveSummary;
    issues: RepositoryExecutionIssue[];
    issueSummary: RepositoryIssueSummary;
    impactedFiles: RepositoryImpactedFile[];
    pathValidation: RepositoryPathValidation;
    confidenceDefinitions: Record<RepositoryPathConfidence, string>;
    findings: RepositoryScanResult[];
    completeness?: ScanCompleteness;
    profileEvidence?: RepositoryProfileEvidence;
    threatModel?: unknown;
}

export interface AnalyzeRepositoryOptions {
    maxFiles?: number;
    maxFileSizeBytes?: number;
    ignorePatterns?: string[];
}

export type RepositoryFileStatus =
    | 'inventoried'
    | 'selected'
    | 'fetched'
    | 'parsed'
    | 'analyzed'
    | 'graph_connected'
    | 'skipped'
    | 'failed';

export type RepositoryFileFailureReason =
    | 'budget_exhausted'
    | 'api_request_budget_exhausted'
    | 'rate_limited'
    | 'file_too_large'
    | 'binary'
    | 'unsupported_type'
    | 'fetch_failed'
    | 'decode_failed'
    | 'parse_failed'
    | 'reference_unresolved'
    | 'excluded'
    | 'unknown';

export type ScanMode = 'full' | 'bounded';
export type CoverageStatus = 'unknown' | 'partial' | 'path_complete' | 'repository_complete';

export interface ScanCompleteness {
    mode: ScanMode;
    coverageStatus: CoverageStatus;
    files: {
        inventoried: number;
        selected: number;
        fetched: number;
        parsed: number;
        analyzed: number;
        graphConnected: number;
    };
    capabilities: {
        discovered: number;
        withControlNeighborhoodSearched: number;
        withControlContextResolved: number;
        unresolved: number;
    };
    references: {
        discovered: number;
        fetched: number;
        parsed: number;
        resolved: number;
        unresolved: number;
    };
    unresolvedContext: Array<{
        capability: CapabilityType;
        artifactId: string;
        missingFilesOrControls: string[];
    }>;
    verdictScope: 'repository_complete' | 'path_complete' | 'partial_context';
    coverageReason: string;
}

export type RepositoryProfileSignal = {
    signalId: string;
    category:
        | 'system_type'
        | 'execution_model'
        | 'deployment'
        | 'capability'
        | 'trust_source'
        | 'control';
    candidateValue: string;
    source: { path: string; line?: number; evidenceId: string };
    evidenceKind:
        | 'executable_code'
        | 'configuration'
        | 'manifest'
        | 'documentation'
        | 'filename'
        | 'test'
        | 'fixture';
    confidence: 'confirmed' | 'probable' | 'potential';
    reason: string;
};

export type RepositoryProfileEvidence = {
    signals: RepositoryProfileSignal[];
};

export interface EvaluateCanonicalFindingsInput {
    rootPath: string;
    analyzedArtifacts: RepositoryArtifact[];
    executionGraph: RepositoryExecutionMap;
    profileEvidence: RepositoryProfileEvidence;
    scanCompleteness: ScanCompleteness;
    threatModel?: unknown;
    scanResults?: RepositoryScanResult[];
    scanStats?: RepositoryScanStats;
}
