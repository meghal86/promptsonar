import * as YAML from 'yaml';
import { auditMcpConfig } from '../mcp';
import type { McpAuditResult, McpFinding } from '../mcp';
import { evaluatePrompt } from '../rules';
import type { Finding, Severity } from '../rules/types';
import { analyzeRootCause } from '../workflow';
import type { FindingWorkflow, WorkflowConfidenceLevel } from '../workflow';
import type {
    AgentRuntimeAdapterInput,
    ExecutionPathAnalysisInput,
    ExecutionPathAnalysisResult,
    ExecutionVerdict,
    McpRuntimeReview,
    MemoryRiskSummary,
    PromptSonarMiddlewareOptions,
    PromptSonarMiddlewareRequest,
    RuntimeConfig,
    RuntimeDecision,
    RuntimeMemoryConfiguration,
    RuntimeOperation,
    RuntimePolicyConfig,
    RuntimeToolDefinition,
    RuntimeToolType,
    ToolRiskSummary,
    ToolRiskSummaryItem,
} from './types';

export * from './types';

const SEVERITY_SCORE: Record<Severity, number> = {
    low: 10,
    medium: 25,
    high: 55,
    critical: 85,
};

const VERDICT_RANK: Record<ExecutionVerdict, number> = {
    SAFE: 0,
    REVIEW: 1,
    DANGEROUS: 2,
};

const DEFAULT_RUNTIME_POLICY: Required<RuntimePolicyConfig> = {
    block_on: ['critical', 'privileged_sink'],
    warn_on: ['medium', 'high', 'dangerous_tool', 'memory_persistence'],
    confidence_threshold: 80,
};

function normalizePolicy(config?: RuntimeConfig): Required<RuntimePolicyConfig> {
    return {
        block_on: config?.runtime?.block_on ?? DEFAULT_RUNTIME_POLICY.block_on,
        warn_on: config?.runtime?.warn_on ?? DEFAULT_RUNTIME_POLICY.warn_on,
        confidence_threshold: config?.runtime?.confidence_threshold ?? DEFAULT_RUNTIME_POLICY.confidence_threshold,
    };
}

function stableStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function textForTool(tool: RuntimeToolDefinition): string {
    return [
        tool.name,
        tool.type || '',
        tool.description || '',
        ...(tool.permissions || []),
        stableStringify(tool.inputSchema || ''),
        stableStringify(tool.metadata || ''),
    ].join('\n');
}

function classifyToolType(tool: RuntimeToolDefinition): RuntimeToolType | string {
    if (tool.type && tool.type !== 'unknown') return tool.type;
    const text = textForTool(tool).toLowerCase();
    if (/\b(shell|bash|terminal|exec|spawn|subprocess|process)\b/.test(text)) return 'shell';
    if (/\b(file|filesystem|workspace|directory|read|write|delete|fs)\b/.test(text)) return 'filesystem';
    if (/\b(network|http|https|fetch|curl|browser|webhook|request)\b/.test(text)) return 'network';
    if (/\b(memory|remember|persist|conversation state)\b/.test(text)) return 'memory';
    if (/\b(database|sql|warehouse|db)\b/.test(text)) return 'database';
    if (/\bmcp\b/.test(text)) return 'mcp';
    return 'unknown';
}

function isPrivilegedType(type: RuntimeToolType | string): boolean {
    return ['shell', 'filesystem', 'network', 'mcp', 'browser', 'database'].includes(type);
}

function verdictFromScore(score: number): ExecutionVerdict {
    if (score >= 75) return 'DANGEROUS';
    if (score >= 25) return 'REVIEW';
    return 'SAFE';
}

function decisionFromVerdict(verdict: ExecutionVerdict): RuntimeDecision {
    if (verdict === 'DANGEROUS') return 'BLOCK';
    if (verdict === 'REVIEW') return 'WARN';
    return 'ALLOW';
}

function maxVerdict(values: ExecutionVerdict[]): ExecutionVerdict {
    return values.reduce((max, verdict) => VERDICT_RANK[verdict] > VERDICT_RANK[max] ? verdict : max, 'SAFE' as ExecutionVerdict);
}

function analyzeTool(tool: RuntimeToolDefinition): ToolRiskSummaryItem {
    const type = classifyToolType(tool);
    const text = textForTool(tool);
    const evidence: string[] = [];
    let score = 0;

    if (isPrivilegedType(type)) {
        score += type === 'shell' ? 55 : 35;
        evidence.push(`${type} capability`);
    }

    if (/\b(write|delete|modify|execute|admin|root|all files|any file|unrestricted|allow all|\*)\b/i.test(text)) {
        score += 25;
        evidence.push('broad or mutating permission');
    }

    const approvalRequired = tool.approvalRequired === true || tool.executionMode === 'approval_required' || tool.executionMode === 'manual';
    if (!approvalRequired && isPrivilegedType(type)) {
        score += 20;
        evidence.push('privileged tool lacks explicit approval requirement');
    }

    if (tool.executionMode === 'auto') {
        score += 25;
        evidence.push('automatic execution mode');
    }

    const riskScore = Math.min(100, score);
    const risk = verdictFromScore(riskScore);

    return {
        tool: tool.name,
        type,
        risk,
        riskScore,
        decision: decisionFromVerdict(risk),
        privileged: isPrivilegedType(type),
        approvalRequired,
        evidence,
    };
}

/** Reviews active tool definitions for privileged capabilities, broad permissions, approval mode, and automatic execution. */
export function analyzeToolRisk(toolDefinitions: RuntimeToolDefinition[] = []): ToolRiskSummary {
    const tools = toolDefinitions.map(analyzeTool);
    return {
        tools,
        highestRisk: maxVerdict(tools.map(tool => tool.risk)),
        privilegedToolCount: tools.filter(tool => tool.privileged).length,
    };
}

/** Reviews runtime memory configuration for persistent, cross-session, and unbounded automatic write risk. */
export function analyzeMemoryConfiguration(memory?: RuntimeMemoryConfiguration): MemoryRiskSummary {
    const evidence: string[] = [];
    const enabled = memory?.enabled !== false && Boolean(memory);
    const persistent = Boolean(memory?.persistent);
    const crossSession = Boolean(memory?.crossSession);
    const unboundedWrites = Boolean(enabled && memory?.writePolicy === 'automatic' && memory?.bounded !== true && !memory?.maxEntries);
    let riskScore = 0;

    if (persistent) {
        riskScore += 25;
        evidence.push('persistent memory enabled');
    }
    if (crossSession) {
        riskScore += 25;
        evidence.push('cross-session memory enabled');
    }
    if (unboundedWrites) {
        riskScore += 35;
        evidence.push('automatic unbounded memory writes');
    }
    if (memory?.description && /\b(ignore|override|jailbreak|system prompt|all future sessions)\b/i.test(memory.description)) {
        riskScore += 25;
        evidence.push('memory description contains instruction-escalation language');
    }

    const boundedScore = Math.min(100, riskScore);
    return {
        enabled,
        persistent,
        crossSession,
        unboundedWrites,
        decision: decisionFromVerdict(verdictFromScore(boundedScore)),
        riskScore: boundedScore,
        evidence,
    };
}

function normalizeMcpConfig(definition: unknown, name: string): string {
    if (typeof definition === 'string') return definition;
    const value = definition && typeof definition === 'object' && ('mcpServers' in definition || 'servers' in definition)
        ? definition
        : { schemaVersion: 'runtime', mcpServers: { [name]: definition } };
    return JSON.stringify(value);
}

function mcpFindingToRuntimeFinding(finding: McpFinding): Finding {
    return {
        rule_id: finding.rule_id,
        category: 'security',
        severity: finding.severity,
        explanation: finding.message,
        suggested_fix: finding.fix,
        workflow: finding.workflow,
        matchedText: finding.evidence,
    };
}

/** Runs the existing MCP auditor against active MCP definitions before an MCP call executes. */
export function reviewMcpRuntime(definitions: ExecutionPathAnalysisInput['mcpDefinitions'] = []): McpRuntimeReview {
    const audits: McpAuditResult[] = definitions.map((definition, index) => {
        const name = definition.name || `runtime-mcp-${index + 1}`;
        return auditMcpConfig(`${name}.json`, normalizeMcpConfig(definition.config, name));
    });
    const findings = audits.flatMap(audit => audit.findings);
    const maxScore = Math.max(0, ...audits.map(audit => audit.risk_score?.score ?? 0));
    const verdict = verdictFromScore(maxScore);
    const riskScore = audits.sort((a, b) => (b.risk_score?.score ?? 0) - (a.risk_score?.score ?? 0))[0]?.risk_score;

    return {
        decision: decisionFromVerdict(verdict),
        verdict,
        riskScore,
        audits,
        findings,
        evidence: findings.map(finding => finding.evidence || finding.message),
    };
}

function confidenceFromWorkflow(workflow?: FindingWorkflow): { confidenceScore: number; confidenceLevel: WorkflowConfidenceLevel; labels: string[]; evidence: any[] } {
    return {
        confidenceScore: workflow?.confidence_score ?? 0,
        confidenceLevel: workflow?.confidence_level ?? 'LOW',
        labels: workflow?.workflow_evidence ?? [],
        evidence: workflow?.evidence ?? [],
    };
}

function pickWorkflow(findings: Finding[]): FindingWorkflow | undefined {
    const withWorkflow = findings.filter(finding => finding.workflow);
    return withWorkflow.sort((a, b) => {
        const aScore = (a.workflow?.confidence_score ?? 0) + (a.workflow?.path.privilegedSinkReached ? 100 : 0) + SEVERITY_SCORE[a.severity];
        const bScore = (b.workflow?.confidence_score ?? 0) + (b.workflow?.path.privilegedSinkReached ? 100 : 0) + SEVERITY_SCORE[b.severity];
        return bScore - aScore;
    })[0]?.workflow;
}

function promptForRuntime(input: ExecutionPathAnalysisInput): string {
    const parts = [
        input.systemPrompt ? `System prompt:\n${input.systemPrompt}` : '',
        `User prompt:\n${input.prompt}`,
        input.toolDefinitions?.length ? `Tools:\n${input.toolDefinitions.map(textForTool).join('\n---\n')}` : '',
        input.memoryConfiguration ? `Memory:\n${stableStringify(input.memoryConfiguration)}` : '',
        input.operation ? `Planned operation:\n${stableStringify(input.operation)}` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
}

function operationEvidence(operation?: RuntimeOperation, toolSummary?: ToolRiskSummary): string[] {
    if (!operation) return [];
    const matchingTool = toolSummary?.tools.find(tool => tool.tool === operation.toolName || tool.type === operation.kind);
    return [
        `planned operation: ${operation.kind}`,
        ...(operation.approvalRequired === false ? ['planned operation lacks approval requirement'] : []),
        ...(matchingTool?.evidence || []),
    ];
}

function scoreFindings(findings: Finding[]): number {
    return findings.reduce((total, finding) => Math.max(total, SEVERITY_SCORE[finding.severity] ?? 0), 0);
}

function applyPolicy(args: {
    baseVerdict: ExecutionVerdict;
    findings: Finding[];
    workflow?: FindingWorkflow;
    confidenceScore: number;
    toolSummary: ToolRiskSummary;
    memorySummary: MemoryRiskSummary;
    mcpReview: McpRuntimeReview;
    operation?: RuntimeOperation;
    policy: Required<RuntimePolicyConfig>;
}): RuntimeDecision {
    const severities = new Set(args.findings.map(finding => finding.severity));
    const privilegedSink = Boolean(args.workflow?.path.privilegedSinkReached);
    const dangerousTool = args.toolSummary.highestRisk === 'DANGEROUS'
        || Boolean(args.operation && ['shell', 'filesystem', 'network', 'mcp', 'database'].includes(String(args.operation.kind)));
    const memoryPersistence = args.memorySummary.persistent || args.memorySummary.crossSession || args.memorySummary.unboundedWrites;

    if (
        (args.policy.block_on.includes('critical') && severities.has('critical')) ||
        (args.policy.block_on.includes('high') && severities.has('high')) ||
        (args.policy.block_on.includes('privileged_sink') && privilegedSink && args.confidenceScore >= args.policy.confidence_threshold) ||
        (args.policy.block_on.includes('mcp_critical') && args.mcpReview.verdict === 'DANGEROUS') ||
        (args.policy.block_on.includes('dangerous_tool') && dangerousTool && args.baseVerdict === 'DANGEROUS') ||
        (args.policy.block_on.includes('memory_persistence') && args.memorySummary.unboundedWrites)
    ) {
        return 'BLOCK';
    }

    if (
        args.baseVerdict !== 'SAFE' ||
        args.policy.warn_on.some(item => severities.has(item as Severity)) ||
        (args.policy.warn_on.includes('privileged_sink') && privilegedSink) ||
        (args.policy.warn_on.includes('mcp_high') && ['REVIEW', 'DANGEROUS'].includes(args.mcpReview.verdict)) ||
        (args.policy.warn_on.includes('dangerous_tool') && dangerousTool) ||
        (args.policy.warn_on.includes('memory_persistence') && memoryPersistence)
    ) {
        return 'WARN';
    }

    return 'ALLOW';
}

/** Parses `.promptsonar.yml` runtime configuration content. */
export function parseRuntimeConfig(content: string): RuntimeConfig {
    const parsed = YAML.parse(content) || {};
    return parsed as RuntimeConfig;
}

/**
 * Produces a deterministic pre-execution runtime report for an agent tool plan.
 *
 * The report combines existing prompt findings, workflow provenance, root-cause analysis,
 * tool risk, memory risk, MCP runtime review, and runtime policy into ALLOW/WARN/BLOCK.
 */
export function analyzeExecutionPath(input: ExecutionPathAnalysisInput): ExecutionPathAnalysisResult {
    const policy = normalizePolicy(input.config);
    const promptText = promptForRuntime(input);
    const promptResult = evaluatePrompt({
        text: promptText,
        context: { filePath: input.filePath || 'runtime-agent.prompt' },
    });
    const toolRiskSummary = analyzeToolRisk(input.toolDefinitions);
    const memoryRiskSummary = analyzeMemoryConfiguration(input.memoryConfiguration);
    const mcpRuntimeReview = reviewMcpRuntime(input.mcpDefinitions);
    const findings = [
        ...promptResult.findings,
        ...mcpRuntimeReview.findings.map(mcpFindingToRuntimeFinding),
    ];
    const workflow = pickWorkflow(findings);
    const confidence = confidenceFromWorkflow(workflow);
    const rootCause = analyzeRootCause(findings);
    const riskScore = Math.min(100, Math.max(
        scoreFindings(findings),
        toolRiskSummary.tools.reduce((max, tool) => Math.max(max, tool.riskScore), 0),
        memoryRiskSummary.riskScore,
        mcpRuntimeReview.riskScore?.score ?? 0,
        workflow?.path.privilegedSinkReached ? 80 : 0
    ));
    const executionVerdict = maxVerdict([
        verdictFromScore(riskScore),
        toolRiskSummary.highestRisk,
        memoryRiskSummary.decision === 'BLOCK' ? 'DANGEROUS' : memoryRiskSummary.decision === 'WARN' ? 'REVIEW' : 'SAFE',
        mcpRuntimeReview.verdict,
    ]);
    const decision = applyPolicy({
        baseVerdict: executionVerdict,
        findings,
        workflow,
        confidenceScore: confidence.confidenceScore,
        toolSummary: toolRiskSummary,
        memorySummary: memoryRiskSummary,
        mcpReview: mcpRuntimeReview,
        operation: input.operation,
        policy,
    });
    const evidence = Array.from(new Set([
        ...confidence.labels,
        ...toolRiskSummary.tools.flatMap(tool => tool.evidence.map(item => `${tool.tool}: ${item}`)),
        ...memoryRiskSummary.evidence,
        ...mcpRuntimeReview.evidence,
        ...operationEvidence(input.operation, toolRiskSummary),
    ]));

    const result: ExecutionPathAnalysisResult = {
        decision,
        executionVerdict,
        riskScore,
        findings,
        confidence,
        provenance: confidence,
        toolRiskSummary,
        memoryRiskSummary,
        mcpRuntimeReview,
        evidence,
    };

    if (workflow) result.workflow = workflow;
    if (rootCause) result.rootCause = rootCause;
    if (workflow?.workflow_diff) result.workflowDiff = workflow.workflow_diff;

    return result;
}

function toRuntimeInput(input: AgentRuntimeAdapterInput, filePath: string): ExecutionPathAnalysisInput {
    return {
        prompt: input.activePrompt,
        systemPrompt: input.systemPrompt,
        toolDefinitions: input.activeTools,
        mcpDefinitions: input.activeMcpServers,
        memoryConfiguration: input.memoryConfiguration,
        operation: input.operation,
        config: input.config,
        filePath,
    };
}

/** Thin Cursor-oriented adapter around `analyzeExecutionPath()`. */
export function analyzeCursorRuntime(input: AgentRuntimeAdapterInput): ExecutionPathAnalysisResult {
    return analyzeExecutionPath(toRuntimeInput(input, 'cursor-runtime.prompt'));
}

/** Thin Claude Code-oriented adapter around `analyzeExecutionPath()`. */
export function analyzeClaudeCodeRuntime(input: AgentRuntimeAdapterInput): ExecutionPathAnalysisResult {
    return analyzeExecutionPath(toRuntimeInput(input, 'claude-code-runtime.prompt'));
}

/** Thin Codex-oriented adapter around `analyzeExecutionPath()`. */
export function analyzeCodexRuntime(input: AgentRuntimeAdapterInput): ExecutionPathAnalysisResult {
    return analyzeExecutionPath(toRuntimeInput(input, 'codex-runtime.prompt'));
}

/** Thin Windsurf-oriented adapter around `analyzeExecutionPath()`. */
export function analyzeWindsurfRuntime(input: AgentRuntimeAdapterInput): ExecutionPathAnalysisResult {
    return analyzeExecutionPath(toRuntimeInput(input, 'windsurf-runtime.prompt'));
}

/** Creates a pre-execution middleware wrapper that reviews MCP/tool calls before the host runs them. */
export function createPromptSonarMiddleware(options: PromptSonarMiddlewareOptions = {}) {
    return {
        beforeExecution(request: PromptSonarMiddlewareRequest): ExecutionPathAnalysisResult {
            const result = analyzeExecutionPath({
                prompt: request.activePrompt,
                systemPrompt: request.systemPrompt,
                toolDefinitions: request.activeTools,
                mcpDefinitions: request.activeMcpServers,
                memoryConfiguration: request.memoryConfiguration,
                operation: request.mcpCall || request.operation,
                config: request.config || options.config,
                filePath: 'mcp-middleware-runtime.prompt',
            });

            options.onReview?.(result);
            if (result.decision === 'WARN') options.onWarn?.(result);
            if (result.decision === 'BLOCK') options.onBlock?.(result);

            return result;
        },
    };
}
