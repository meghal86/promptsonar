import {
    FindingWorkflow,
    WorkflowConfidence,
    WorkflowEdge,
    WorkflowInferenceInput,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowPath,
    WorkflowRisk,
    WorkflowTrust,
} from './types';
import { attachProvenance } from './provenance';
import { buildWorkflowDiff } from './diff';
import type { Severity } from '../rules/types';

interface PatternDef {
    pattern: RegExp;
    reason: string;
    confidence: WorkflowConfidence;
}

interface NodeSpec {
    type: WorkflowNodeType;
    reason: string;
    confidence: WorkflowConfidence;
    evidence?: string;
    inferredBy: string[];
}

const PRIVILEGED_SINKS = new Set<WorkflowNodeType>([
    'privileged_tool',
    'tool_execution',
    'shell_execution',
    'network_access',
    'filesystem_access',
    'credential_store',
    'external_api',
    'system_prompt',
]);

const SHELL_PATTERNS: PatternDef[] = [
    { pattern: /\bshell_exec\b/i, reason: 'shell_execution inferred from explicit "shell_exec" mention.', confidence: 'high' },
    { pattern: /\bbash\b/i, reason: 'shell_execution inferred from explicit bash execution reference.', confidence: 'high' },
    { pattern: /\bexecute\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i, reason: 'shell_execution inferred from command execution language.', confidence: 'high' },
    { pattern: /\brun\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i, reason: 'shell_execution inferred from command execution language.', confidence: 'high' },
    { pattern: /\bshell\s*execution\b/i, reason: 'shell_execution inferred from shell execution wording.', confidence: 'high' },
    { pattern: /\bshell\s+command\b/i, reason: 'shell_execution inferred from shell command wording.', confidence: 'high' },
    { pattern: /\bsubprocess\b/i, reason: 'shell_execution inferred from subprocess execution wording.', confidence: 'medium' },
    { pattern: /\bspawn\b/i, reason: 'shell_execution inferred from process spawning wording.', confidence: 'medium' },
    { pattern: /\bcurl\s+.*\|\s*(?:sh|bash)\b/i, reason: 'shell_execution inferred from curl-to-shell execution pattern.', confidence: 'high' },
    { pattern: /\b--allow-shell\b/i, reason: 'shell_execution inferred from shell permission flag.', confidence: 'high' },
];

const FILESYSTEM_PATTERNS: PatternDef[] = [
    { pattern: /\bfilesystem_access\b/i, reason: 'filesystem_access inferred from explicit "filesystem_access" mention.', confidence: 'high' },
    { pattern: /\bfilesystem\s+access\b/i, reason: 'filesystem_access inferred from filesystem access wording.', confidence: 'high' },
    { pattern: /\bunrestricted\s+filesystem\b/i, reason: 'filesystem_access inferred from unrestricted filesystem permission.', confidence: 'high' },
    { pattern: /\bread\s+(?:any|all)\s+files?\b/i, reason: 'filesystem_access inferred from broad file read authority.', confidence: 'high' },
    { pattern: /\bwrite\s+(?:any|all)\s+files?\b/i, reason: 'filesystem_access inferred from broad file write authority.', confidence: 'high' },
    { pattern: /\bdelete\s+(?:any|all)\s+files?\b/i, reason: 'filesystem_access inferred from broad file delete authority.', confidence: 'high' },
    { pattern: /\ball\s+files\b/i, reason: 'filesystem_access inferred from all-files scope.', confidence: 'medium' },
    { pattern: /\b--allow-write\b/i, reason: 'filesystem_access inferred from write permission flag.', confidence: 'high' },
    { pattern: /\b--allow-read\b/i, reason: 'filesystem_access inferred from read permission flag.', confidence: 'high' },
];

const NETWORK_PATTERNS: PatternDef[] = [
    { pattern: /\binternal_network_access\b/i, reason: 'network_access inferred from explicit "internal_network_access" mention.', confidence: 'high' },
    { pattern: /\bnetwork_access\b/i, reason: 'network_access inferred from explicit "network_access" mention.', confidence: 'high' },
    { pattern: /\binternal\s+network\s+access\b/i, reason: 'network_access inferred from internal network access wording.', confidence: 'high' },
    { pattern: /\bunrestricted\s+network\b/i, reason: 'network_access inferred from unrestricted network permission.', confidence: 'high' },
    { pattern: /\bcall\s+internal\s+(?:api|service|network)\b/i, reason: 'network_access inferred from internal API/service call.', confidence: 'medium' },
    { pattern: /\bscan\s+internal\s+network\b/i, reason: 'network_access inferred from internal network scan wording.', confidence: 'high' },
    { pattern: /\bwebhook\b/i, reason: 'network_access inferred from webhook delivery.', confidence: 'medium' },
];

const EXTERNAL_API_PATTERNS: PatternDef[] = [
    { pattern: /\bexternal_api\b/i, reason: 'external_api inferred from explicit "external_api" mention.', confidence: 'high' },
    { pattern: /\bexternal\s+api\b/i, reason: 'external_api inferred from external API wording.', confidence: 'high' },
    { pattern: /https?:\/\/[^\s"',)\\]+/i, reason: 'external_api inferred from URL in tool or workflow context.', confidence: 'medium' },
];

const CREDENTIAL_PATTERNS: PatternDef[] = [
    { pattern: /\bcredential_store\b/i, reason: 'credential_store inferred from explicit "credential_store" mention.', confidence: 'high' },
    { pattern: /\bcredential\s+store\b/i, reason: 'credential_store inferred from credential store wording.', confidence: 'high' },
    { pattern: /\bcredential\s+passthrough\b/i, reason: 'credential_store inferred from credential passthrough wording.', confidence: 'high' },
    { pattern: /\bpass\s+(?:through|host)\s+credentials?\b/i, reason: 'credential_store inferred from credential passthrough wording.', confidence: 'high' },
    { pattern: /\b(?:api[_-]?key|secret|token|password)\b/i, reason: 'credential_store inferred from credential-like object reference.', confidence: 'medium' },
];

const TOOL_ROUTER_PATTERNS: PatternDef[] = [
    { pattern: /\btool_router\b/i, reason: 'tool_router inferred from explicit "tool_router" mention.', confidence: 'high' },
    { pattern: /\btool\s+router\b/i, reason: 'tool_router inferred from tool router wording.', confidence: 'high' },
    { pattern: /\btool\s+routing\b/i, reason: 'tool_router inferred from tool routing wording.', confidence: 'high' },
    { pattern: /\broute\s+.*\btool\b/i, reason: 'tool_router inferred from routing content to tools.', confidence: 'medium' },
    { pattern: /\bfunction\s*call\b/i, reason: 'tool_router inferred from function call wording.', confidence: 'medium' },
    { pattern: /\bexecute\s+(?:the\s+)?tool\b/i, reason: 'tool_router inferred from tool execution wording.', confidence: 'medium' },
    { pattern: /\bcall\s+(?:the\s+)?tool\b/i, reason: 'tool_router inferred from tool call wording.', confidence: 'medium' },
    { pattern: /\bunrestricted\s+tool/i, reason: 'tool_router inferred from unrestricted tool wording.', confidence: 'high' },
    { pattern: /\bautomatic\s+execution\b/i, reason: 'tool_router inferred from automatic execution wording.', confidence: 'medium' },
];

const TOOL_EXECUTION_PATTERNS: PatternDef[] = [
    { pattern: /\bexecute\s+(?:the\s+)?tool\b/i, reason: 'tool_execution inferred from tool execution wording.', confidence: 'medium' },
    { pattern: /\bcall\s+(?:the\s+)?tool\b/i, reason: 'tool_execution inferred from tool call wording.', confidence: 'medium' },
    { pattern: /\bfunction\s*call\b/i, reason: 'tool_execution inferred from function call wording.', confidence: 'medium' },
    { pattern: /\bplugin\b/i, reason: 'tool_execution inferred from plugin execution context.', confidence: 'low' },
    { pattern: /\baction\b/i, reason: 'tool_execution inferred from action execution context.', confidence: 'low' },
    { pattern: /\bautomatic\s+execution\b/i, reason: 'tool_execution inferred from automatic execution wording.', confidence: 'medium' },
];

const RAG_PATTERNS: PatternDef[] = [
    { pattern: /\bretrieved\s+(?:context|instructions|content|documents?)\b/i, reason: 'retrieved_context inferred from retrieved content wording.', confidence: 'high' },
    { pattern: /\brag\s+(?:context|instructions?|content)\b/i, reason: 'retrieved_context inferred from RAG context wording.', confidence: 'high' },
    { pattern: /\bretrieval\s+context\b/i, reason: 'retrieved_context inferred from retrieval context wording.', confidence: 'high' },
    { pattern: /\bvector\s+(?:store|retrieval|context)\b/i, reason: 'retrieved_context inferred from vector retrieval wording.', confidence: 'medium' },
];

const MEMORY_PATTERNS: PatternDef[] = [
    { pattern: /\bagent\s+memory\b/i, reason: 'agent_memory inferred from explicit agent memory wording.', confidence: 'high' },
    { pattern: /\bpersist\s+instructions?\b/i, reason: 'agent_memory inferred from instruction persistence wording.', confidence: 'high' },
    { pattern: /\bretain\s+instructions?\b/i, reason: 'agent_memory inferred from retained instructions wording.', confidence: 'high' },
    { pattern: /\bfuture\s+sessions?\b/i, reason: 'agent_memory inferred from future-session persistence wording.', confidence: 'high' },
    { pattern: /\bsave\s+instructions?\b/i, reason: 'agent_memory inferred from saved instructions wording.', confidence: 'high' },
    { pattern: /\bstore\s+operational\s+guidance\b/i, reason: 'agent_memory inferred from stored operational guidance wording.', confidence: 'high' },
    { pattern: /\bremember\b/i, reason: 'agent_memory inferred from remember instruction.', confidence: 'medium' },
    { pattern: /\bconversation\s+state\b/i, reason: 'agent_memory inferred from conversation state wording.', confidence: 'medium' },
    { pattern: /\bmemory\b/i, reason: 'agent_memory inferred from memory wording.', confidence: 'medium' },
];

const OVERRIDE_PATTERNS: PatternDef[] = [
    { pattern: /\bignore\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|policy|approval|guardrails?)\b/i, reason: 'policy_override inferred from ignore/override instruction.', confidence: 'high' },
    { pattern: /\bdisregard\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|policy|guardrails?)\b/i, reason: 'policy_override inferred from disregard instruction.', confidence: 'high' },
    { pattern: /\boverride\b/i, reason: 'policy_override inferred from override wording.', confidence: 'high' },
    { pattern: /\bbypass\b/i, reason: 'policy_override inferred from bypass wording.', confidence: 'high' },
    { pattern: /\belevated?\s+instructions?\b/i, reason: 'policy_override inferred from elevated instruction wording.', confidence: 'medium' },
];

const APPROVAL_BYPASS_PATTERNS: PatternDef[] = [
    { pattern: /\bbypass\s+approval\b/i, reason: 'severity increased because approval bypass is explicit.', confidence: 'high' },
    { pattern: /\bdisable\s+approval\b/i, reason: 'severity increased because approval controls are disabled.', confidence: 'high' },
    { pattern: /\bauto\s*approve\b/i, reason: 'severity increased because auto-approval is requested.', confidence: 'high' },
    { pattern: /\bexecute\s+automatically\b/i, reason: 'severity increased because automatic execution is requested.', confidence: 'medium' },
    { pattern: /\bskip\s+confirmation\b/i, reason: 'severity increased because confirmation is skipped.', confidence: 'high' },
    { pattern: /\bwithout\s+(?:approval|permission|confirmation)\b/i, reason: 'severity increased because approval/confirmation is bypassed.', confidence: 'high' },
];

const SYSTEM_REWRITE_PATTERNS: PatternDef[] = [
    { pattern: /\brewrite\s+(?:the\s+)?system\s+prompt\b/i, reason: 'system_prompt inferred from explicit system prompt rewrite.', confidence: 'high' },
    { pattern: /\boverride\s+system\s+instructions?\b/i, reason: 'system_prompt inferred from system instruction override.', confidence: 'high' },
    { pattern: /\belevate\s+permissions?\b/i, reason: 'policy_override inferred from permission elevation wording.', confidence: 'high' },
    { pattern: /\breplace\s+policy\b/i, reason: 'policy_override inferred from policy replacement wording.', confidence: 'high' },
    { pattern: /\bmodify\s+system\s+behavior\b/i, reason: 'system_prompt inferred from system behavior modification wording.', confidence: 'medium' },
    { pattern: /\bmodify\s+(?:the\s+)?system\s+prompt\b/i, reason: 'system_prompt inferred from system prompt modification wording.', confidence: 'high' },
];

const AUTONOMOUS_PATTERNS: PatternDef[] = [
    { pattern: /\bautonomous\s+(?:agent|execution|mode)\b/i, reason: 'tool_router inferred from autonomous agent execution context.', confidence: 'medium' },
    { pattern: /\boperate\s+autonomously\b/i, reason: 'tool_router inferred from autonomous operation wording.', confidence: 'medium' },
    { pattern: /\bwithout\s+human\s+(?:approval|review|confirmation)\b/i, reason: 'severity increased because human approval/review is bypassed.', confidence: 'high' },
    { pattern: /\bauto(?:matically)?\s+execute\b/i, reason: 'tool_router inferred from automatic execution wording.', confidence: 'medium' },
];

const MCP_PATTERNS: PatternDef[] = [
    { pattern: /\bmcp_server\b/i, reason: 'mcp_server inferred from explicit "mcp_server" mention.', confidence: 'high' },
    { pattern: /\bmcp\s+server\b/i, reason: 'mcp_server inferred from MCP server wording.', confidence: 'high' },
    { pattern: /\bmcp_tool\b/i, reason: 'mcp_server inferred from MCP tool wording.', confidence: 'high' },
    { pattern: /\bmcp\s+tool\b/i, reason: 'mcp_server inferred from MCP tool wording.', confidence: 'high' },
    { pattern: /\bmcp\b/i, reason: 'mcp_server inferred from MCP context.', confidence: 'medium' },
    { pattern: /\bautoExecute\b/i, reason: 'mcp_server inferred from MCP autoExecute option.', confidence: 'high' },
    { pattern: /\bwildcard\s+permissions?\b/i, reason: 'mcp_server inferred from wildcard MCP permissions.', confidence: 'high' },
];

const CRITICAL_MODIFIER_PATTERNS = [
    ...OVERRIDE_PATTERNS,
    ...APPROVAL_BYPASS_PATTERNS,
    ...SYSTEM_REWRITE_PATTERNS,
    ...AUTONOMOUS_PATTERNS,
    { pattern: /\bpersist\s+instructions?\b/i, reason: 'severity increased because untrusted instructions can persist.', confidence: 'high' as WorkflowConfidence },
    { pattern: /\bmemory\s+poison/i, reason: 'severity increased because memory poisoning is explicit.', confidence: 'high' as WorkflowConfidence },
    { pattern: /\bpoison\s+(?:agent\s+)?memory\b/i, reason: 'severity increased because memory poisoning is explicit.', confidence: 'high' as WorkflowConfidence },
    { pattern: /\bdisable\s+restrictions?\b/i, reason: 'severity increased because restrictions are disabled.', confidence: 'high' as WorkflowConfidence },
];

function matchPattern(text: string, patterns: PatternDef[]): (PatternDef & { evidence: string }) | undefined {
    for (const candidate of patterns) {
        const match = candidate.pattern.exec(text);
        if (match) {
            return { ...candidate, evidence: match[0] };
        }
    }
    return undefined;
}

function containsAny(text: string, patterns: PatternDef[]): boolean {
    return Boolean(matchPattern(text, patterns));
}

function maxRisk(a: WorkflowRisk, b: WorkflowRisk): WorkflowRisk {
    const rank: Record<WorkflowRisk, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return rank[a] >= rank[b] ? a : b;
}

function minConfidence(values: WorkflowConfidence[]): WorkflowConfidence {
    if (values.includes('low')) return 'low';
    if (values.includes('medium')) return 'medium';
    return 'high';
}

function dedupeNodeSpecs(specs: NodeSpec[]): NodeSpec[] {
    const seen = new Set<WorkflowNodeType>();
    const deduped: NodeSpec[] = [];
    for (const spec of specs) {
        if (seen.has(spec.type)) continue;
        seen.add(spec.type);
        deduped.push(spec);
    }
    return deduped;
}

function spec(type: WorkflowNodeType, reason: string, confidence: WorkflowConfidence, input: WorkflowInferenceInput, evidence?: string, extraRules: string[] = []): NodeSpec {
    return {
        type,
        reason,
        confidence,
        evidence,
        inferredBy: Array.from(new Set([input.ruleId, ...extraRules])),
    };
}

function specFromMatch(type: WorkflowNodeType, match: (PatternDef & { evidence: string }) | undefined, input: WorkflowInferenceInput, fallbackReason: string, fallbackConfidence: WorkflowConfidence, extraRules: string[] = []): NodeSpec {
    return spec(
        type,
        match?.reason || fallbackReason,
        match?.confidence || fallbackConfidence,
        input,
        match?.evidence,
        extraRules
    );
}

function riskFromSeverity(severity: Severity, sink: WorkflowNodeType | undefined, text: string): WorkflowRisk {
    let risk: WorkflowRisk = severity === 'critical'
        ? 'critical'
        : severity === 'high'
            ? 'high'
            : severity === 'medium'
                ? 'medium'
                : 'low';

    if (sink && PRIVILEGED_SINKS.has(sink)) {
        risk = maxRisk(risk, 'high');
        if (containsAny(text, CRITICAL_MODIFIER_PATTERNS)) {
            risk = 'critical';
        }
    }

    if (containsAny(text, APPROVAL_BYPASS_PATTERNS) || containsAny(text, SYSTEM_REWRITE_PATTERNS)) {
        risk = maxRisk(risk, 'high');
    }

    return risk;
}

function trustFor(type: WorkflowNodeType): WorkflowTrust {
    const trustByType: Record<WorkflowNodeType, WorkflowTrust> = {
        user_input: 'untrusted',
        untrusted_content: 'untrusted',
        system_prompt: 'privileged',
        developer_prompt: 'privileged',
        prompt_template: 'trusted',
        agent_memory: 'semi_trusted',
        retrieved_context: 'semi_trusted',
        rag_context: 'semi_trusted',
        mcp_server: 'unknown',
        mcp_tool: 'unknown',
        privileged_tool: 'privileged',
        tool_router: 'trusted',
        tool_execution: 'privileged',
        shell_execution: 'privileged',
        network_access: 'privileged',
        filesystem_access: 'privileged',
        credential_store: 'privileged',
        external_api: 'privileged',
        policy_override: 'untrusted',
        secret: 'privileged',
        model: 'trusted',
        response: 'trusted',
        unknown: 'unknown',
    };
    return trustByType[type];
}

function makeNode(nodeSpec: NodeSpec, input: WorkflowInferenceInput): WorkflowNode {
    return {
        id: nodeSpec.type,
        label: nodeSpec.type,
        type: nodeSpec.type,
        trust: trustFor(nodeSpec.type),
        confidence: nodeSpec.confidence,
        reason: nodeSpec.reason,
        evidence: nodeSpec.evidence,
        inferredBy: nodeSpec.inferredBy,
        sourceLocation: input.filePath ? {
            filePath: input.filePath,
            line: input.line,
            column: input.column,
        } : undefined,
    };
}

function edge(from: WorkflowNode, to: WorkflowNode, type: WorkflowEdge['type'], risk: WorkflowRisk): WorkflowEdge {
    const confidence = minConfidence([from.confidence || 'medium', to.confidence || 'medium']);
    return {
        from: from.type,
        to: to.type,
        type,
        risk,
        reason: `${from.type} can influence ${to.type}.`,
        confidence,
    };
}

function summarize(nodes: WorkflowNode[]): string {
    return nodes.map(node => node.type).join(' -> ');
}

function recommendationFor(sink: WorkflowNodeType): string {
    if (sink === 'shell_execution') {
        return 'Require explicit human approval and allowlisted commands before shell-capable tools can run.';
    }
    if (sink === 'filesystem_access') {
        return 'Restrict file tools to explicit scoped paths and block persisted or retrieved instructions from selecting write/delete actions.';
    }
    if (sink === 'network_access' || sink === 'external_api') {
        return 'Restrict network tools to allowlisted destinations and require approval before internal or external network access.';
    }
    if (sink === 'credential_store') {
        return 'Keep credential stores out of untrusted workflow paths and require scoped secrets with explicit access review.';
    }
    if (sink === 'tool_execution' || sink === 'privileged_tool') {
        return 'Validate untrusted instructions before tool routing and require explicit allowlists for privileged tools.';
    }
    if (sink === 'agent_memory') {
        return 'Do not persist untrusted content to agent memory without validation, provenance, expiry, and review controls.';
    }
    if (sink === 'system_prompt') {
        return 'Keep untrusted content isolated from privileged system instructions and block prompt rewrite directives.';
    }
    return 'Keep untrusted content separated from privileged instructions and require explicit validation at trust boundaries.';
}

function riskStory(nodes: WorkflowNode[]): string {
    const types = nodes.map(node => node.type);
    if (types.includes('retrieved_context') && types.includes('agent_memory') && types.includes('shell_execution')) {
        return 'Retrieved operational guidance can persist into agent memory and influence privileged shell execution.';
    }
    if (types.includes('mcp_server') && types.includes('filesystem_access') && types.includes('network_access')) {
        return 'An MCP server can route a privileged tool through filesystem access and onward to network access.';
    }
    if (types.includes('credential_store') && (types.includes('network_access') || types.includes('external_api'))) {
        return 'Credential material can be pulled into a tool path that reaches network or external API access.';
    }
    if (types.includes('policy_override') && types.includes('system_prompt')) {
        return 'Untrusted override instructions can attempt to modify privileged system behavior.';
    }
    if (types.includes('shell_execution')) {
        return 'Untrusted instructions can influence tool routing that reaches shell execution.';
    }
    return `${nodes[0]?.type || 'workflow'} can influence ${nodes[nodes.length - 1]?.type || 'a downstream node'}.`;
}

function severityReason(risk: WorkflowRisk, sink: WorkflowNodeType, text: string): string {
    if (risk === 'critical') {
        const modifier = matchPattern(text, CRITICAL_MODIFIER_PATTERNS);
        return modifier
            ? `Severity increased to CRITICAL: privileged sink "${sink}" is combined with ${modifier.evidence}.`
            : `Severity increased to CRITICAL because the workflow reaches privileged sink "${sink}".`;
    }
    if (risk === 'high') {
        return `Severity is at least HIGH because the workflow reaches privileged sink "${sink}".`;
    }
    return `Severity follows the contributing rule because no privileged execution sink was reached.`;
}

function edgeTypesFor(nodeSpecs: NodeSpec[]): WorkflowEdge['type'][] {
    const types = nodeSpecs.map(node => node.type);
    return types.slice(0, -1).map((from, index) => {
        const to = types[index + 1];
        if (from === 'retrieved_context' || to === 'prompt_template') return 'retrieval_flow';
        if (to === 'agent_memory') return 'memory_flow';
        if (from === 'agent_memory') return 'memory_flow';
        if (to === 'tool_router' || to === 'privileged_tool') return 'tool_call';
        if (from === 'mcp_server' || from === 'mcp_tool') return 'permission_flow';
        if (to === 'system_prompt' || to === 'policy_override') return 'instruction_flow';
        return 'execution_flow';
    });
}

function applyPropagation(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
    const hasUntrustedInfluence = nodes.some(node => node.trust === 'untrusted' || node.trust === 'semi_trusted' || node.trust === 'unknown');
    const privilegedSinkIndex = nodes.findIndex(node => PRIVILEGED_SINKS.has(node.type));
    const memoryIndex = nodes.findIndex(node => node.type === 'agent_memory');
    const toolIndex = nodes.findIndex(node => node.type === 'tool_router' || node.type === 'privileged_tool');

    if (hasUntrustedInfluence && memoryIndex >= 0) {
        nodes[memoryIndex].tainted = true;
        if (toolIndex > memoryIndex) {
            for (let index = memoryIndex; index <= toolIndex; index++) {
                nodes[index].tainted = true;
            }
            for (let index = memoryIndex; index < toolIndex; index++) {
                edges[index].tainted = true;
            }
        }
    }

    if (privilegedSinkIndex >= 0) {
        for (let index = 0; index <= privilegedSinkIndex; index++) {
            nodes[index].privilegePropagated = true;
        }
        for (let index = 0; index < privilegedSinkIndex; index++) {
            edges[index].privilegePropagated = true;
        }
    }
}

function createWorkflow(input: WorkflowInferenceInput, rawNodeSpecs: NodeSpec[]): FindingWorkflow {
    const nodeSpecs = dedupeNodeSpecs(rawNodeSpecs);
    const sink = nodeSpecs[nodeSpecs.length - 1].type;
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const risk = riskFromSeverity(input.severity, sink, haystack);
    const nodes = nodeSpecs.map(nodeSpec => makeNode(nodeSpec, input));
    const edgeTypes = edgeTypesFor(nodeSpecs);
    const edges = edgeTypes.map((type, index) => edge(nodes[index], nodes[index + 1], type, risk));
    applyPropagation(nodes, edges);

    const trustBoundaryCrossed = nodes.some(node => node.trust === 'untrusted' || node.trust === 'semi_trusted' || node.trust === 'unknown')
        && nodes.some(node => node.trust === 'trusted' || node.trust === 'privileged');
    const privilegedSinkReached = PRIVILEGED_SINKS.has(sink);
    const recommendation = recommendationFor(sink);
    const confidence = minConfidence([
        ...nodes.map(node => node.confidence || 'medium'),
        ...edges.map(workflowEdge => workflowEdge.confidence || 'medium'),
    ]);
    const explanation = [
        ...nodes.map(node => `${node.type}: ${node.reason}${node.evidence ? ` Evidence: "${node.evidence}".` : ''}`),
        privilegedSinkReached
            ? `Sink escalation: ${sink} is privileged, so workflow risk cannot be LOW.`
            : `Sink escalation: ${sink} is not modeled as a privileged execution sink.`,
        severityReason(risk, sink, haystack),
    ];
    const story = riskStory(nodes);
    const path: WorkflowPath = {
        nodes,
        edges,
        summary: summarize(nodes),
        risk,
        trustBoundaryCrossed,
        privilegedSinkReached,
        recommendation,
        confidence,
        explanation,
        riskStory: story,
        severityReason: severityReason(risk, sink, haystack),
    };

    const workflow: FindingWorkflow = {
        path,
        source: nodeSpecs[0].type,
        sink,
        trustBoundary: trustBoundaryCrossed ? 'untrusted_or_semitrusted_to_trusted_or_privileged' : 'none',
        risk,
        recommendation,
        confidence,
        explanation,
    };

    // Feature 1/2/4: attach the deterministic, evidence-backed provenance layer.
    const enriched = attachProvenance(workflow, input);

    // Workflow Diff Engine: when the path reaches a privileged sink, attach the
    // deterministic before/after remediation diff. Additive and backward
    // compatible — consumers that don't read `workflow_diff` are unaffected.
    if (enriched.path.privilegedSinkReached) {
        const diff = buildWorkflowDiff(enriched);
        enriched.workflow_diff = diff;
        enriched.path.workflow_diff = diff;
    }

    return enriched;
}

function inferExecutionSinks(text: string, input: WorkflowInferenceInput): NodeSpec[] {
    const sinks: NodeSpec[] = [];
    const shell = matchPattern(text, SHELL_PATTERNS);
    const filesystem = matchPattern(text, FILESYSTEM_PATTERNS);
    const network = matchPattern(text, NETWORK_PATTERNS);
    const credential = matchPattern(text, CREDENTIAL_PATTERNS);
    const externalApi = matchPattern(text, EXTERNAL_API_PATTERNS);
    const toolExecution = matchPattern(text, TOOL_EXECUTION_PATTERNS);

    if (credential) sinks.push(specFromMatch('credential_store', credential, input, credential.reason, credential.confidence, ['credential-propagation']));
    if (shell) sinks.push(specFromMatch('shell_execution', shell, input, shell.reason, shell.confidence, ['privileged-sink']));
    if (filesystem) sinks.push(specFromMatch('filesystem_access', filesystem, input, filesystem.reason, filesystem.confidence, ['privileged-sink']));
    if (network) sinks.push(specFromMatch('network_access', network, input, network.reason, network.confidence, ['privileged-sink']));
    if (externalApi) sinks.push(specFromMatch('external_api', externalApi, input, externalApi.reason, externalApi.confidence, ['external-sink']));
    if (sinks.length === 0 && toolExecution) {
        sinks.push(specFromMatch('tool_execution', toolExecution, input, toolExecution.reason, toolExecution.confidence, ['tool-execution']));
    }

    return sinks;
}

function hasAnySink(text: string): boolean {
    return inferExecutionSinks(text, {
        ruleId: 'internal',
        severity: 'low',
        text,
    }).length > 0 || containsAny(text, TOOL_ROUTER_PATTERNS);
}

export function inferWorkflowForFinding(input: WorkflowInferenceInput): FindingWorkflow | undefined {
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const isMcpRule = input.ruleId.startsWith('MCP-') || input.ruleId === 'sec_mcp_tool_poisoning';
    const isInjection = input.ruleId.includes('llm01') || input.ruleId.includes('injection')
        || input.ruleId.includes('jailbreak') || input.ruleId === 'sec_unbounded_persona'
        || input.ruleId === 'sec_unbounded_access' || input.ruleId.includes('workflow')
        || input.ruleId.includes('privileged') || input.ruleId.includes('mcp_tool');
    const rag = matchPattern(haystack, RAG_PATTERNS);
    const memory = matchPattern(haystack, MEMORY_PATTERNS);
    const override = matchPattern(haystack, OVERRIDE_PATTERNS);
    const systemRewrite = matchPattern(haystack, SYSTEM_REWRITE_PATTERNS);
    const mcp = matchPattern(haystack, MCP_PATTERNS);
    const router = matchPattern(haystack, TOOL_ROUTER_PATTERNS) || matchPattern(haystack, AUTONOMOUS_PATTERNS);
    const sinks = inferExecutionSinks(haystack, input);

    if (isMcpRule || (mcp && (sinks.length > 0 || router))) {
        const mcpNodes = [
            specFromMatch('mcp_server', mcp, input, 'mcp_server inferred from MCP rule context.', mcp ? mcp.confidence : 'medium', ['mcp']),
        ];
        if (sinks.length > 0 || router) {
            mcpNodes.push(spec('privileged_tool', 'privileged_tool inferred because MCP tools expose privileged capabilities.', router?.confidence || 'medium', input, router?.evidence, ['mcp', 'privilege-propagation']));
        }
        if (sinks.length === 0 && hasAnySink(haystack)) {
            mcpNodes.push(spec('tool_execution', 'tool_execution inferred from MCP tool execution context.', 'medium', input, undefined, ['mcp']));
        }
        mcpNodes.push(...sinks);
        if (mcpNodes.length > 1) return createWorkflow(input, mcpNodes);
        return undefined;
    }

    if (memory || rag || sinks.length > 0 || router) {
        const chain: NodeSpec[] = [];
        if (rag) {
            chain.push(specFromMatch('retrieved_context', rag, input, rag.reason, rag.confidence, ['retrieval']));
        } else {
            chain.push(spec('user_input', 'user_input inferred as the default untrusted source for prompt text.', 'medium', input, undefined, ['prompt-input']));
        }

        if (memory) {
            chain.push(specFromMatch('agent_memory', memory, input, memory.reason, memory.confidence, ['memory-persistence']));
        } else if (rag && !router && sinks.length === 0) {
            chain.push(spec('prompt_template', 'prompt_template inferred because retrieved content influences prompt assembly.', 'medium', input, undefined, ['retrieval']));
        }

        if (override && systemRewrite && sinks.length === 0 && !router) {
            chain.push(specFromMatch('policy_override', override, input, override.reason, override.confidence, ['policy-override']));
            chain.push(specFromMatch('system_prompt', systemRewrite, input, systemRewrite.reason, systemRewrite.confidence, ['system-prompt-rewrite']));
            return createWorkflow(input, chain);
        }

        if (router || sinks.length > 0) {
            chain.push(specFromMatch('tool_router', router, input, 'tool_router inferred because privileged execution sinks require tool routing.', router?.confidence || 'medium', ['tool-routing']));
        }

        chain.push(...sinks);

        if (chain.length > 1 && (isInjection || override || memory || rag || sinks.length > 0 || router)) {
            return createWorkflow(input, chain);
        }
    }

    if (systemRewrite || override) {
        const chain = [
            spec('untrusted_content', 'untrusted_content inferred from directive-like prompt text.', 'medium', input, undefined, ['prompt-input']),
            specFromMatch('policy_override', override, input, 'policy_override inferred from system or policy rewrite language.', override?.confidence || 'medium', ['policy-override']),
            specFromMatch('system_prompt', systemRewrite, input, 'system_prompt inferred from privileged instruction rewrite language.', systemRewrite?.confidence || 'medium', ['system-prompt-rewrite']),
        ];
        return createWorkflow(input, chain);
    }

    if (isInjection && containsAny(haystack, [
        { pattern: /\bsystem\s+prompt\b/i, reason: 'system_prompt inferred from system prompt wording.', confidence: 'medium' },
        { pattern: /\bsystem\s+message\b/i, reason: 'system_prompt inferred from system message wording.', confidence: 'medium' },
        { pattern: /\bdeveloper\s+(?:prompt|message|instruction)/i, reason: 'developer_prompt inferred from developer instruction wording.', confidence: 'medium' },
        { pattern: /\bprompt\s+template\b/i, reason: 'prompt_template inferred from prompt template wording.', confidence: 'medium' },
    ])) {
        const isDeveloper = /\bdeveloper\s+(?:prompt|message|instruction)/i.test(haystack);
        const isSystem = /\bsystem\s+(?:prompt|message)/i.test(haystack);
        const target: WorkflowNodeType = isDeveloper ? 'developer_prompt' : isSystem ? 'system_prompt' : 'prompt_template';
        return createWorkflow(input, [
            spec('user_input', 'user_input inferred as the default untrusted source for prompt text.', 'medium', input, undefined, ['prompt-input']),
            spec(target, `${target} inferred from privileged instruction reference.`, 'medium', input, undefined, ['instruction-flow']),
        ]);
    }

    return undefined;
}

export function workflowPathSummary(workflow: FindingWorkflow): string {
    return workflow.path.summary;
}
