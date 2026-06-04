import type {
    FindingWorkflow,
    WorkflowConfidence,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowReplay,
    WorkflowReplayEvent,
    WorkflowReplayEventEvidence,
    WorkflowReplayEventType,
    WorkflowReplayRiskVerdict,
    WorkflowRisk,
    WorkflowTrust,
} from './types';

export const WORKFLOW_REPLAY_VERSION = '1.0';

const EVENT_TYPE_BY_NODE: Partial<Record<WorkflowNodeType, WorkflowReplayEventType>> = {
    user_input: 'USER_INPUT',
    untrusted_content: 'USER_INPUT',
    system_prompt: 'SYSTEM_PROMPT',
    developer_prompt: 'SYSTEM_PROMPT',
    prompt_template: 'SYSTEM_PROMPT',
    agent_memory: 'MEMORY_READ',
    retrieved_context: 'MEMORY_READ',
    rag_context: 'MEMORY_READ',
    mcp_server: 'MCP_SERVER',
    mcp_tool: 'MCP_TOOL',
    privileged_tool: 'MCP_TOOL',
    tool_router: 'TOOL_ROUTER',
    tool_execution: 'MCP_TOOL',
    shell_execution: 'SHELL',
    network_access: 'NETWORK',
    filesystem_access: 'FILESYSTEM',
    external_api: 'NETWORK',
    model: 'MODEL',
    response: 'RESPONSE',
};

const RISK_RANK: Record<WorkflowReplayRiskVerdict, number> = {
    SAFE: 0,
    REVIEW: 1,
    DANGEROUS: 2,
};

function maxRisk(a: WorkflowReplayRiskVerdict, b: WorkflowReplayRiskVerdict): WorkflowReplayRiskVerdict {
    return RISK_RANK[b] > RISK_RANK[a] ? b : a;
}

function verdictFromWorkflowRisk(risk?: WorkflowRisk): WorkflowReplayRiskVerdict {
    if (risk === 'critical' || risk === 'high') return 'DANGEROUS';
    if (risk === 'medium' || risk === 'low') return 'REVIEW';
    return 'SAFE';
}

function verdictFromNode(node: WorkflowNode, incoming?: WorkflowEdge): WorkflowReplayRiskVerdict {
    if (node.trust === 'privileged' || node.privilegePropagated) return 'DANGEROUS';
    if (incoming?.risk === 'critical' || incoming?.risk === 'high' || incoming?.privilegePropagated) return 'DANGEROUS';
    if (node.trust === 'semi_trusted' || node.trust === 'unknown' || node.tainted) return 'REVIEW';
    if (incoming?.type === 'trust_boundary' || incoming?.tainted) return 'REVIEW';
    return verdictFromWorkflowRisk(incoming?.risk);
}

function formatReplayTimestamp(index: number): string {
    return `T+00:00:${String(index).padStart(2, '0')}.000`;
}

function eventTypeFor(node: WorkflowNode): WorkflowReplayEventType {
    if (node.type === 'agent_memory') {
        const text = [
            node.reason,
            node.evidence,
            ...(node.inferredBy || []),
            ...(node.provenance?.ruleMatches || []),
            ...(node.provenance?.evidence.map(item => item.label) || []),
            ...(node.provenance?.evidence.map(item => item.source) || []),
        ].filter(Boolean).join('\n');
        return /\b(write|persist|retain|future sessions?|save|memory_persistence)\b/i.test(text) ? 'MEMORY_WRITE' : 'MEMORY_READ';
    }
    return EVENT_TYPE_BY_NODE[node.type] || 'MODEL';
}

function normalizeConfidence(confidence?: WorkflowConfidence): WorkflowConfidence {
    return confidence || 'medium';
}

function boundaryCrossed(previous?: WorkflowNode, current?: WorkflowNode, incoming?: WorkflowEdge): boolean {
    if (incoming?.type === 'trust_boundary') return true;
    if (!previous || !current) return false;
    const fromUntrusted = previous.trust === 'untrusted' || previous.trust === 'semi_trusted' || previous.trust === 'unknown';
    const toTrusted = current.trust === 'trusted' || current.trust === 'privileged';
    return fromUntrusted && toTrusted;
}

function provenanceFor(node: WorkflowNode): WorkflowReplayEventEvidence[] {
    const evidence = node.provenance?.evidence || [];
    if (evidence.length > 0) {
        return evidence.map(item => ({
            ruleId: item.ruleId,
            label: item.label,
            source: item.source,
            severity: item.severity,
        }));
    }
    return [{
        label: node.evidence || node.reason || `${node.type} inferred from workflow graph`,
        source: node.inferredBy?.join(', '),
    }];
}

function matchedRulesFor(node: WorkflowNode, provenance: WorkflowReplayEventEvidence[]): string[] {
    return Array.from(new Set([
        ...(node.provenance?.ruleMatches || []),
        ...provenance.map(item => item.ruleId).filter((ruleId): ruleId is string => Boolean(ruleId)),
        ...(node.inferredBy || []),
    ]));
}

/** Builds a deterministic event timeline from an inferred workflow graph. */
export function buildWorkflowReplay(workflow: FindingWorkflow): WorkflowReplay {
    const events: WorkflowReplayEvent[] = [];
    let currentRisk: WorkflowReplayRiskVerdict = 'SAFE';

    workflow.path.nodes.forEach((node, index) => {
        const previous = workflow.path.nodes[index - 1];
        const incoming = index > 0 ? workflow.path.edges[index - 1] : undefined;
        const eventRisk = verdictFromNode(node, incoming);
        const riskBefore = currentRisk;
        const riskAfter = maxRisk(currentRisk, eventRisk);
        const provenance = provenanceFor(node);
        const matchedRules = matchedRulesFor(node, provenance);

        events.push({
            index: index + 1,
            timestamp: formatReplayTimestamp(index),
            type: eventTypeFor(node),
            nodeId: node.id,
            nodeType: node.type,
            label: node.label,
            trust: node.trust || ('unknown' as WorkflowTrust),
            confidence: normalizeConfidence(node.confidence),
            confidenceContribution: node.provenance?.confidenceContribution || 0,
            trustBoundaryCrossed: boundaryCrossed(previous, node, incoming),
            riskBefore,
            riskAfter,
            riskTransition: `${riskBefore}->${riskAfter}`,
            reason: node.reason || incoming?.reason || `${node.type} inferred from workflow graph`,
            matchedRules,
            provenance,
        });

        currentRisk = riskAfter;
    });

    return {
        replay_version: WORKFLOW_REPLAY_VERSION,
        generated_from: 'workflow_graph',
        timeline: events.map(event => event.type),
        risk_evolution: events.map(event => event.riskAfter),
        events,
    };
}
