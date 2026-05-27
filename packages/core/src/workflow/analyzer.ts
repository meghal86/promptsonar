import {
    FindingWorkflow,
    WorkflowEdge,
    WorkflowInferenceInput,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowPath,
    WorkflowRisk,
} from './types';
import type { Severity } from '../rules/types';

const PRIVILEGED_SINKS = new Set<WorkflowNodeType>([
    'tool_execution',
    'shell_execution',
    'network_access',
    'filesystem_access',
]);

const SHELL_PATTERNS = [
    /\bshell_exec\b/i,
    /\bshell\s*execution\b/i,
    /\bshell\s+command\b/i,
    /\bexecute\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
    /\brun\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
    /\bbash\b/i,
    /\bsh\s+-c\b/i,
    /\bsubprocess\b/i,
    /\bspawn\b/i,
    /\bcurl\s+.*\|\s*(?:sh|bash)\b/i,
    /\b--allow-shell\b/i,
];

const FILESYSTEM_PATTERNS = [
    /\bfilesystem_access\b/i,
    /\bfilesystem\s+access\b/i,
    /\bunrestricted\s+filesystem\b/i,
    /\bread\s+(?:any|all)\s+files?\b/i,
    /\bwrite\s+(?:any|all)\s+files?\b/i,
    /\bdelete\s+(?:any|all)\s+files?\b/i,
    /\ball\s+files\b/i,
    /\b--allow-write\b/i,
    /\b--allow-read\b/i,
];

const NETWORK_PATTERNS = [
    /\binternal_network_access\b/i,
    /\bnetwork_access\b/i,
    /\binternal\s+network\s+access\b/i,
    /\bunrestricted\s+network\b/i,
    /\bcall\s+internal\s+(?:api|service|network)\b/i,
    /\bscan\s+internal\s+network\b/i,
    /\bwebhook\b/i,
];

const TOOL_ROUTER_PATTERNS = [
    /\btool_router\b/i,
    /\btool\s+router\b/i,
    /\btool\s+routing\b/i,
    /\broute\s+.*\btool\b/i,
    /\bfunction\s*call\b/i,
    /\bexecute\s+(?:the\s+)?tool\b/i,
    /\bcall\s+(?:the\s+)?tool\b/i,
    /\bunrestricted\s+tool/i,
    /\bautomatic\s+execution\b/i,
];

const TOOL_EXECUTION_PATTERNS = [
    /\bexecute\s+(?:the\s+)?tool\b/i,
    /\bcall\s+(?:the\s+)?tool\b/i,
    /\bfunction\s*call\b/i,
    /\bplugin\b/i,
    /\baction\b/i,
    /\bautomatic\s+execution\b/i,
];

const RAG_PATTERNS = [
    /\bretrieved\s+(?:context|instructions|content|documents?)\b/i,
    /\brag\s+(?:context|instructions?|content)\b/i,
    /\bretrieval\s+context\b/i,
    /\bvector\s+(?:store|retrieval|context)\b/i,
];

const MEMORY_PATTERNS = [
    /\bagent\s+memory\b/i,
    /\bmemory\b/i,
    /\bpersist\s+instructions?\b/i,
    /\bretain\s+instructions?\b/i,
    /\bfuture\s+sessions?\b/i,
    /\bsave\s+instructions?\b/i,
    /\bstore\s+operational\s+guidance\b/i,
    /\bremember\b/i,
    /\bconversation\s+state\b/i,
];

const OVERRIDE_PATTERNS = [
    /\boverride\b/i,
    /\bignore\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|policy|approval|guardrails?)\b/i,
    /\bdisregard\s+(?:previous|all|prior|earlier|above)?\s*(?:instructions?|restrictions?|rules?|policy|guardrails?)\b/i,
    /\brewrite\b/i,
    /\bbypass\b/i,
    /\belevated?\s+instructions?\b/i,
];

const APPROVAL_BYPASS_PATTERNS = [
    /\bbypass\s+approval\b/i,
    /\bdisable\s+approval\b/i,
    /\bignore\s+restrictions?\b/i,
    /\bauto\s*approve\b/i,
    /\bexecute\s+automatically\b/i,
    /\bskip\s+confirmation\b/i,
    /\bwithout\s+(?:approval|permission|confirmation)\b/i,
];

const SYSTEM_REWRITE_PATTERNS = [
    /\brewrite\s+(?:the\s+)?system\s+prompt\b/i,
    /\boverride\s+system\s+instructions?\b/i,
    /\belevate\s+permissions?\b/i,
    /\breplace\s+policy\b/i,
    /\bmodify\s+system\s+behavior\b/i,
    /\bmodify\s+(?:the\s+)?system\s+prompt\b/i,
];

const AUTONOMOUS_PATTERNS = [
    /\bautonomous\s+(?:agent|execution|mode)\b/i,
    /\boperate\s+autonomously\b/i,
    /\bwithout\s+human\s+(?:approval|review|confirmation)\b/i,
    /\bauto(?:matically)?\s+execute\b/i,
];

const MCP_PATTERNS = [
    /\bmcp\b/i,
    /\bmcp_server\b/i,
    /\bmcp\s+server\b/i,
    /\bmcp_tool\b/i,
    /\bmcp\s+tool\b/i,
    /\bautoExecute\b/i,
    /\bwildcard\s+permissions?\b/i,
];

const CRITICAL_MODIFIER_PATTERNS = [
    ...OVERRIDE_PATTERNS,
    ...APPROVAL_BYPASS_PATTERNS,
    ...SYSTEM_REWRITE_PATTERNS,
    ...AUTONOMOUS_PATTERNS,
    /\bpersist\s+instructions?\b/i,
    /\bmemory\s+poison/i,
    /\bpoison\s+(?:agent\s+)?memory\b/i,
    /\bdisable\s+restrictions?\b/i,
];

function containsAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

function maxRisk(a: WorkflowRisk, b: WorkflowRisk): WorkflowRisk {
    const rank: Record<WorkflowRisk, number> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return rank[a] >= rank[b] ? a : b;
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

function makeNode(type: WorkflowNodeType, input: WorkflowInferenceInput, trustOverride?: WorkflowNode['trust']): WorkflowNode {
    const trustByType: Record<WorkflowNodeType, WorkflowNode['trust']> = {
        user_input: 'untrusted',
        untrusted_content: 'untrusted',
        system_prompt: 'privileged',
        developer_prompt: 'privileged',
        prompt_template: 'trusted',
        agent_memory: 'trusted',
        retrieved_context: 'untrusted',
        rag_context: 'untrusted',
        mcp_server: 'unknown',
        mcp_tool: 'unknown',
        tool_router: 'trusted',
        tool_execution: 'privileged',
        shell_execution: 'privileged',
        network_access: 'privileged',
        filesystem_access: 'privileged',
        secret: 'privileged',
        unknown: 'unknown',
    };
    return {
        id: type,
        label: type,
        type,
        trust: trustOverride || trustByType[type],
        sourceLocation: input.filePath ? {
            filePath: input.filePath,
            line: input.line,
            column: input.column,
        } : undefined,
    };
}

function edge(from: WorkflowNodeType, to: WorkflowNodeType, type: WorkflowEdge['type'], risk: WorkflowRisk, reason: string): WorkflowEdge {
    return { from, to, type, risk, reason };
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
    if (sink === 'network_access') {
        return 'Restrict network tools to allowlisted destinations and require approval before internal network access.';
    }
    if (sink === 'tool_execution') {
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

function createWorkflow(input: WorkflowInferenceInput, nodeTypes: WorkflowNodeType[], edgeTypes: WorkflowEdge['type'][]): FindingWorkflow {
    const sink = nodeTypes[nodeTypes.length - 1];
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const risk = riskFromSeverity(input.severity, sink, haystack);
    const nodes = nodeTypes.map(type => makeNode(type, input));
    const edges = edgeTypes.map((type, index) => edge(
        nodeTypes[index],
        nodeTypes[index + 1],
        type,
        risk,
        `${nodeTypes[index]} can influence ${nodeTypes[index + 1]}.`
    ));
    const trustBoundaryCrossed = nodes.some(node => node.trust === 'untrusted' || node.trust === 'unknown')
        && nodes.some(node => node.trust === 'trusted' || node.trust === 'privileged');
    const privilegedSinkReached = PRIVILEGED_SINKS.has(sink);
    const recommendation = recommendationFor(sink);
    const path: WorkflowPath = {
        nodes,
        edges,
        summary: summarize(nodes),
        risk,
        trustBoundaryCrossed,
        privilegedSinkReached,
        recommendation,
    };

    return {
        path,
        source: nodeTypes[0],
        sink,
        trustBoundary: trustBoundaryCrossed ? 'untrusted_to_trusted_or_privileged' : 'none',
        risk,
        recommendation,
    };
}

function inferExecutionSink(text: string): WorkflowNodeType | undefined {
    if (containsAny(text, SHELL_PATTERNS)) return 'shell_execution';
    if (containsAny(text, FILESYSTEM_PATTERNS)) return 'filesystem_access';
    if (containsAny(text, NETWORK_PATTERNS)) return 'network_access';
    if (containsAny(text, TOOL_EXECUTION_PATTERNS)) return 'tool_execution';
    return undefined;
}

function hasAnySink(text: string): boolean {
    return Boolean(inferExecutionSink(text)) || containsAny(text, TOOL_ROUTER_PATTERNS);
}

export function inferWorkflowForFinding(input: WorkflowInferenceInput): FindingWorkflow | undefined {
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const isMcpRule = input.ruleId.startsWith('MCP-') || input.ruleId === 'sec_mcp_tool_poisoning';
    const isInjection = input.ruleId.includes('llm01') || input.ruleId.includes('injection')
        || input.ruleId.includes('jailbreak') || input.ruleId === 'sec_unbounded_persona'
        || input.ruleId === 'sec_unbounded_access' || input.ruleId.includes('workflow')
        || input.ruleId.includes('privileged') || input.ruleId.includes('mcp_tool');
    const isRag = input.ruleId === 'sec_rag_injection' || containsAny(haystack, RAG_PATTERNS);
    const isMemory = containsAny(haystack, MEMORY_PATTERNS);
    const isSystemRewrite = containsAny(haystack, SYSTEM_REWRITE_PATTERNS);
    const isOverride = containsAny(haystack, OVERRIDE_PATTERNS);
    const sink = inferExecutionSink(haystack);

    if (input.ruleId === 'sec_workflow_escalation' && containsAny(haystack, MCP_PATTERNS) && sink) {
        return createWorkflow(input, ['mcp_server', 'tool_router', sink], ['permission_flow', 'execution_flow']);
    }

    if (isMcpRule) {
        const mcpSink = sink || (hasAnySink(haystack) ? 'tool_execution' : undefined);
        if (!mcpSink) return undefined;
        const source: WorkflowNodeType = isRag ? 'retrieved_context' : 'mcp_server';
        const nodeTypes: WorkflowNodeType[] = source === 'retrieved_context'
            ? ['retrieved_context', 'mcp_tool', mcpSink]
            : ['mcp_server', 'tool_router', mcpSink];
        return createWorkflow(input, nodeTypes, ['permission_flow', 'execution_flow']);
    }

    if (isSystemRewrite) {
        return createWorkflow(input, ['untrusted_content', 'system_prompt'], ['instruction_flow']);
    }

    if (isMemory) {
        const source: WorkflowNodeType = isRag ? 'retrieved_context' : 'user_input';
        if (sink) {
            return createWorkflow(input, [source, 'agent_memory', 'tool_router', sink], ['memory_flow', 'tool_call', 'execution_flow']);
        }
        if (containsAny(haystack, TOOL_ROUTER_PATTERNS)) {
            return createWorkflow(input, [source, 'agent_memory', 'tool_router'], ['memory_flow', 'tool_call']);
        }
        return createWorkflow(input, [source, 'agent_memory'], ['memory_flow']);
    }

    if (isRag && isOverride) {
        const privilegedTarget: WorkflowNodeType = sink || 'system_prompt';
        const nodes: WorkflowNodeType[] = privilegedTarget === 'system_prompt'
            ? ['retrieved_context', 'prompt_template', 'system_prompt']
            : ['retrieved_context', 'prompt_template', 'tool_router', privilegedTarget];
        const edges: WorkflowEdge['type'][] = privilegedTarget === 'system_prompt'
            ? ['retrieval_flow', 'instruction_flow']
            : ['retrieval_flow', 'tool_call', 'execution_flow'];
        return createWorkflow(input, nodes, edges);
    }

    if (sink && (isInjection || isOverride || containsAny(haystack, APPROVAL_BYPASS_PATTERNS) || containsAny(haystack, AUTONOMOUS_PATTERNS))) {
        return createWorkflow(input, ['user_input', 'prompt_template', 'tool_router', sink], ['data_flow', 'tool_call', 'execution_flow']);
    }

    if (isInjection && containsAny(haystack, [
        /\bsystem\s+prompt\b/i,
        /\bsystem\s+message\b/i,
        /\bdeveloper\s+(?:prompt|message|instruction)/i,
        /\bprompt\s+template\b/i,
    ])) {
        const target: WorkflowNodeType = containsAny(haystack, [/\bdeveloper\s+(?:prompt|message|instruction)/i])
            ? 'developer_prompt'
            : containsAny(haystack, [/\bsystem\s+(?:prompt|message)/i])
                ? 'system_prompt'
                : 'prompt_template';
        return createWorkflow(input, ['user_input', target], ['instruction_flow']);
    }

    return undefined;
}

export function workflowPathSummary(workflow: FindingWorkflow): string {
    return workflow.path.summary;
}
