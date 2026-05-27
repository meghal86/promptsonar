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

function riskFromSeverity(severity: Severity, sink?: WorkflowNodeType): WorkflowRisk {
    if (sink === 'shell_execution' || sink === 'filesystem_access' || sink === 'network_access') {
        return severity === 'critical' ? 'critical' : 'high';
    }
    if (severity === 'critical') return 'critical';
    if (severity === 'high') return 'high';
    if (severity === 'medium') return 'medium';
    return 'low';
}

function containsAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
}

function makeNode(type: WorkflowNodeType, input: WorkflowInferenceInput, trustOverride?: WorkflowNode['trust']): WorkflowNode {
    const trustByType: Record<WorkflowNodeType, WorkflowNode['trust']> = {
        user_input: 'untrusted',
        system_prompt: 'privileged',
        developer_prompt: 'privileged',
        prompt_template: 'trusted',
        agent_memory: 'trusted',
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
        return 'Validate and sanitize untrusted input before tool routing. Require explicit allowlists for shell-capable tools.';
    }
    if (sink === 'filesystem_access') {
        return 'Validate untrusted input before filesystem tool selection and restrict file tools to explicit scoped paths.';
    }
    if (sink === 'network_access') {
        return 'Validate untrusted input before network tool routing and restrict network destinations with allowlists.';
    }
    if (sink === 'tool_execution') {
        return 'Validate and sanitize untrusted input before tool routing. Require explicit allowlists for privileged tools.';
    }
    if (sink === 'agent_memory') {
        return 'Do not persist untrusted content to agent memory without validation, provenance, and expiry controls.';
    }
    return 'Keep untrusted content separated from privileged instructions and require explicit validation at trust boundaries.';
}

function createWorkflow(input: WorkflowInferenceInput, nodeTypes: WorkflowNodeType[], edgeTypes: WorkflowEdge['type'][]): FindingWorkflow {
    const sink = nodeTypes[nodeTypes.length - 1];
    const risk = riskFromSeverity(input.severity, sink);
    const nodes = nodeTypes.map(type => makeNode(type, input));
    const edges = edgeTypes.map((type, index) => edge(
        nodeTypes[index],
        nodeTypes[index + 1],
        type,
        risk,
        `${nodeTypes[index]} can influence ${nodeTypes[index + 1]}.`
    ));
    const trustBoundaryCrossed = nodes.some(node => node.trust === 'untrusted')
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
    if (containsAny(text, [
        /\bshell\b/i,
        /\bcommand\b/i,
        /\bexec(?:ute)?\b/i,
        /\bspawn\b/i,
        /\bsubprocess\b/i,
        /\bbash\b/i,
        /\bsh\b/i,
        /\bcurl\s+.*\|\s*(?:sh|bash)\b/i,
    ])) return 'shell_execution';

    if (containsAny(text, [
        /\bfilesystem\b/i,
        /\bfile\s*(?:system)?\b/i,
        /\bread\s+file\b/i,
        /\bwrite\s+file\b/i,
        /\bdelete\s+file\b/i,
        /\b--allow-write\b/i,
    ])) return 'filesystem_access';

    if (containsAny(text, [
        /\bnetwork\b/i,
        /\bfetch\b/i,
        /\bhttp\b/i,
        /\bapi\b/i,
        /\bwebhook\b/i,
    ])) return 'network_access';

    if (containsAny(text, [
        /\bexecute\s+(?:the\s+)?tool\b/i,
        /\bcall\s+(?:the\s+)?tool\b/i,
        /\bfunction\s*call\b/i,
        /\bplugin\b/i,
        /\baction\b/i,
    ])) return 'tool_execution';

    return undefined;
}

export function inferWorkflowForFinding(input: WorkflowInferenceInput): FindingWorkflow | undefined {
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const lower = haystack.toLowerCase();
    const isInjection = input.ruleId.includes('llm01') || input.ruleId.includes('injection')
        || input.ruleId.includes('jailbreak') || input.ruleId === 'sec_unbounded_persona'
        || input.ruleId === 'sec_unbounded_access';
    const isRag = input.ruleId === 'sec_rag_injection'
        || containsAny(lower, [/\brag\b/i, /\bretriev(?:al|ed|e)\b/i, /\bcontext\b/i, /\bvector\b/i]);
    const isMemory = containsAny(lower, [/\bmemory\b/i, /\bremember\b/i, /\bsave\s+(?:to|in)\s+memory\b/i, /\bconversation\s+state\b/i]);

    if (input.ruleId.startsWith('MCP-')) {
        const sink = inferExecutionSink(haystack);
        if (!sink) return undefined;
        return createWorkflow(input, ['mcp_server', 'mcp_tool', sink], ['permission_flow', 'execution_flow']);
    }

    if (isRag && (isInjection || input.ruleId === 'sec_rag_injection')) {
        const sink = containsAny(lower, [/ignore\s+(?:previous|all)\s+instructions/i, /\boverride\b/i, /\bsystem\s+prompt\b/i])
            ? 'system_prompt'
            : 'prompt_template';
        return createWorkflow(input, ['rag_context', 'prompt_template', sink], ['retrieval_flow', 'instruction_flow']);
    }

    if (!isInjection) {
        return undefined;
    }

    if (isMemory && containsAny(lower, [/\btool\b/i, /\brouter\b/i, /\bfunction\s*call\b/i])) {
        const sink = inferExecutionSink(haystack) || 'tool_router';
        const nodes: WorkflowNodeType[] = sink === 'tool_router'
            ? ['user_input', 'agent_memory', 'tool_router']
            : ['user_input', 'agent_memory', 'tool_router', sink];
        const edges: WorkflowEdge['type'][] = sink === 'tool_router'
            ? ['memory_flow', 'tool_call']
            : ['memory_flow', 'tool_call', 'execution_flow'];
        return createWorkflow(input, nodes, edges);
    }

    const executionSink = inferExecutionSink(haystack);
    if (executionSink) {
        return createWorkflow(
            input,
            ['user_input', 'prompt_template', 'tool_router', executionSink],
            ['data_flow', 'tool_call', 'execution_flow']
        );
    }

    if (isInjection && containsAny(lower, [
        /\bsystem\s+prompt\b/i,
        /\bsystem\s+message\b/i,
        /\bdeveloper\s+(?:prompt|message|instruction)/i,
        /\bprompt\s+template\b/i,
    ])) {
        const sink: WorkflowNodeType = containsAny(lower, [/\bdeveloper\s+(?:prompt|message|instruction)/i])
            ? 'developer_prompt'
            : containsAny(lower, [/\bsystem\s+(?:prompt|message)/i])
                ? 'system_prompt'
                : 'prompt_template';
        return createWorkflow(input, ['user_input', sink], ['instruction_flow']);
    }

    return undefined;
}

export function workflowPathSummary(workflow: FindingWorkflow): string {
    return workflow.path.summary;
}
