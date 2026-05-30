import {
    FindingWorkflow,
    WorkflowDiff,
    WorkflowDiffReason,
    WorkflowEdge,
    WorkflowGraph,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowPath,
    WorkflowRisk,
    WorkflowTrust,
} from './types';

// Schema version for the WorkflowDiff contract. Bump on shape changes so
// downstream consumers (SARIF, dashboard, future replay/benchmark tooling) can
// branch on version instead of breaking. See docs/workflow-diff.md.
export const WORKFLOW_DIFF_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Workflow Diff Engine
//
// Given a "before" execution graph (the dangerous path the analyzer inferred)
// and an "after" graph (the hardened path), compute exactly what changed:
// removed/added nodes and edges, removed privileged sinks, trust-boundary
// transitions, and a deterministic risk-reduction percentage.
//
// Everything here is pure and deterministic: no AI, no randomness, no I/O.
// ---------------------------------------------------------------------------

const PRIVILEGED_SINK_TYPES = new Set<WorkflowNodeType>([
    'privileged_tool',
    'tool_execution',
    'shell_execution',
    'network_access',
    'filesystem_access',
    'credential_store',
    'external_api',
    'system_prompt',
]);

// Node types removed by hardening: the privileged sinks plus the routing /
// poisoning surface that carries untrusted input to them.
const REMEDIATED_REMOVE_TYPES = new Set<WorkflowNodeType>([
    ...PRIVILEGED_SINK_TYPES,
    'tool_router',
    'mcp_server',
    'mcp_tool',
    'policy_override',
]);

// Fixed per-sink risk weights (deterministic). A single critical shell path
// scores ~95 (critical); a benign user_input -> model -> response path scores ~5.
const SINK_WEIGHT: Partial<Record<WorkflowNodeType, number>> = {
    shell_execution: 55,
    credential_store: 50,
    filesystem_access: 45,
    network_access: 45,
    system_prompt: 45,
    external_api: 40,
    privileged_tool: 35,
    tool_execution: 30,
};

const UNTRUSTED_TRUSTS = new Set<WorkflowTrust>(['untrusted', 'semi_trusted', 'unknown']);

function clamp(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function edgeId(workflowEdge: Pick<WorkflowEdge, 'from' | 'to'>): string {
    return `${workflowEdge.from} -> ${workflowEdge.to}`;
}

// Deterministic 0–100 risk magnitude for a graph, derived only from its nodes.
export function computeGraphRisk(nodes: WorkflowNode[]): { risk: WorkflowRisk; riskScore: number } {
    const sinkTypes = Array.from(new Set(nodes.filter(node => PRIVILEGED_SINK_TYPES.has(node.type)).map(node => node.type)));
    let score = 0;
    for (const type of sinkTypes) {
        score += SINK_WEIGHT[type] ?? 20;
    }

    const hasUntrusted = nodes.some(node => UNTRUSTED_TRUSTS.has(node.trust));
    const hasPrivileged = nodes.some(node => node.trust === 'privileged');
    if (hasUntrusted && hasPrivileged) {
        score += 25;
    }
    if (nodes.some(node => node.type === 'tool_router' || node.type === 'mcp_server' || node.type === 'mcp_tool')) {
        score += 15;
    }
    // A benign path that still carries untrusted input retains a small residual risk.
    if (score === 0 && hasUntrusted) {
        score = 5;
    }

    score = clamp(score);
    const risk: WorkflowRisk = score >= 85
        ? 'critical'
        : score >= 60
            ? 'high'
            : score >= 30
                ? 'medium'
                : score > 0
                    ? 'low'
                    : 'none';
    return { risk, riskScore: score };
}

function buildGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowGraph {
    const { risk, riskScore } = computeGraphRisk(nodes);
    const hasUntrusted = nodes.some(node => UNTRUSTED_TRUSTS.has(node.trust));
    const hasPrivileged = nodes.some(node => node.trust === 'privileged');
    return {
        nodes,
        edges,
        risk,
        riskScore,
        privilegedSinkReached: nodes.some(node => PRIVILEGED_SINK_TYPES.has(node.type)),
        trustBoundaryCrossed: hasUntrusted && hasPrivileged,
    };
}

// Convert an inferred WorkflowPath into a comparable WorkflowGraph.
export function pathToGraph(path: Pick<WorkflowPath, 'nodes' | 'edges'>): WorkflowGraph {
    return buildGraph(path.nodes, path.edges);
}

function makeNode(type: WorkflowNodeType, label: string, trust: WorkflowTrust, reason: string): WorkflowNode {
    return { id: type, label, type, trust, confidence: 'high', reason };
}

function sequentialEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
    const edges: WorkflowEdge[] = [];
    for (let index = 0; index < nodes.length - 1; index++) {
        edges.push({
            from: nodes[index].type,
            to: nodes[index + 1].type,
            type: 'data_flow',
            risk: 'none',
            reason: `${nodes[index].type} flows to ${nodes[index + 1].type} within the hardened boundary.`,
            confidence: 'high',
        });
    }
    return edges;
}

// Derive the deterministic hardened "after" graph from a dangerous "before"
// graph. Privileged sinks and the routing/poisoning surface are removed and
// the flow is re-anchored to a benign MODEL -> RESPONSE boundary. If nothing
// dangerous is present, the graph is returned unchanged (no-op remediation).
//
// IMPORTANT — v1 assumption (intentional approximation):
//   This is a *derived safe-path approximation*, NOT a rescanned hardened
//   prompt. We do not re-run the scanner on a remediated artifact; we
//   structurally strip the dangerous nodes/edges from the inferred graph and
//   substitute the canonical benign boundary (USER INPUT -> MODEL -> RESPONSE).
//   It answers "if these dangerous nodes were removed, what would the path look
//   like?" — useful as remediation proof, but it is a model, not a measurement.
//
//   Future versions may replace this approximation with:
//     - actual remediation scans (scan the auto-hardened prompt/config),
//     - workflow replay (re-infer the path from the rewritten artifact),
//     - before/after validation (assert the rescanned path matches `after`).
//   The `workflowDiffVersion` field exists so those upgrades can ship without
//   breaking existing consumers.
export function deriveRemediatedGraph(before: WorkflowGraph): WorkflowGraph {
    const hasRemovable = before.nodes.some(node => REMEDIATED_REMOVE_TYPES.has(node.type));
    if (!hasRemovable) {
        return buildGraph(before.nodes, before.edges);
    }

    const kept = before.nodes.filter(node => !REMEDIATED_REMOVE_TYPES.has(node.type));
    const safeNodes: WorkflowNode[] = kept.length > 0
        ? [...kept]
        : [makeNode('user_input', 'User input', 'untrusted', 'user_input is the benign entry point after hardening.')];

    safeNodes.push(makeNode('model', 'Model boundary', 'trusted', 'model boundary mediates input without privileged tool access.'));
    safeNodes.push(makeNode('response', 'Response context', 'trusted', 'response is returned without reaching a privileged sink.'));

    const seen = new Set<WorkflowNodeType>();
    const dedupedNodes = safeNodes.filter(node => {
        if (seen.has(node.type)) return false;
        seen.add(node.type);
        return true;
    });

    return buildGraph(dedupedNodes, sequentialEdges(dedupedNodes));
}

// Classify why the workflow changed, from the structural diff. Priority order:
// a full privileged-sink removal is the headline; a sink removed while another
// remains is partial; otherwise we attribute to the removed boundary/routing
// surface; and an empty diff is no_change.
function classifyDiffReason(args: {
    removedNodes: string[];
    removedSinks: string[];
    afterPrivilegedSinkReached: boolean;
    riskReduction: number;
    trustBoundaryRemoved: boolean;
}): WorkflowDiffReason {
    const { removedNodes, removedSinks, afterPrivilegedSinkReached, riskReduction, trustBoundaryRemoved } = args;

    if (removedNodes.length === 0 && riskReduction === 0) {
        return 'no_change';
    }
    if (removedSinks.length > 0) {
        return afterPrivilegedSinkReached ? 'partial_remediation' : 'privileged_sink_removed';
    }
    // No privileged sink was removed — attribute to the structural surface removed.
    if (removedNodes.some(type => type === 'mcp_server' || type === 'mcp_tool' || type === 'policy_override')) {
        return 'trust_boundary_removed';
    }
    if (removedNodes.includes('tool_router')) {
        return 'routing_surface_removed';
    }
    if (trustBoundaryRemoved) {
        return 'trust_boundary_removed';
    }
    return 'partial_remediation';
}

// Compare two graphs and produce the structural diff + risk reduction.
//
// NOTE: `after` is whatever the caller supplies. When produced by
// `deriveRemediatedGraph` it is the v1 safe-path approximation described above
// (a model, not a rescan). Callers may also pass a real rescanned graph once
// workflow replay exists — this function is agnostic to how `after` was built.
export function computeWorkflowDiff(before: WorkflowGraph, after: WorkflowGraph): WorkflowDiff {
    const beforeNodeTypes = before.nodes.map(node => node.type);
    const afterNodeTypes = after.nodes.map(node => node.type);
    const beforeNodeSet = new Set(beforeNodeTypes);
    const afterNodeSet = new Set(afterNodeTypes);

    const removedNodes = beforeNodeTypes.filter(type => !afterNodeSet.has(type));
    const addedNodes = afterNodeTypes.filter(type => !beforeNodeSet.has(type));

    const beforeEdgeIds = before.edges.map(edgeId);
    const afterEdgeIds = after.edges.map(edgeId);
    const beforeEdgeSet = new Set(beforeEdgeIds);
    const afterEdgeSet = new Set(afterEdgeIds);

    const removedEdges = beforeEdgeIds.filter(id => !afterEdgeSet.has(id));
    const addedEdges = afterEdgeIds.filter(id => !beforeEdgeSet.has(id));

    const beforeSinks = Array.from(new Set(before.nodes.filter(node => PRIVILEGED_SINK_TYPES.has(node.type)).map(node => node.type)));
    const afterSinks = new Set(after.nodes.filter(node => PRIVILEGED_SINK_TYPES.has(node.type)).map(node => node.type));
    const removedSinks = beforeSinks.filter(type => !afterSinks.has(type));
    const addedSinks = Array.from(afterSinks).filter(type => !beforeSinks.includes(type));

    const beforePermissions = before.edges.filter(workflowEdge => workflowEdge.type === 'permission_flow').map(edgeId);
    const afterPermissions = after.edges.filter(workflowEdge => workflowEdge.type === 'permission_flow').map(edgeId);
    const afterPermissionSet = new Set(afterPermissions);
    const beforePermissionSet = new Set(beforePermissions);
    const removedPermissions = beforePermissions.filter(id => !afterPermissionSet.has(id));
    const addedPermissions = afterPermissions.filter(id => !beforePermissionSet.has(id));

    const riskReduction = before.riskScore > 0
        ? clamp(((before.riskScore - after.riskScore) / before.riskScore) * 100)
        : 0;

    const executionPathRemoved = before.privilegedSinkReached && !after.privilegedSinkReached;
    const trustBoundaryRemoved = before.trustBoundaryCrossed && !after.trustBoundaryCrossed;

    const diffReason = classifyDiffReason({
        removedNodes,
        removedSinks,
        afterPrivilegedSinkReached: after.privilegedSinkReached,
        riskReduction,
        trustBoundaryRemoved,
    });

    return {
        workflowDiffVersion: WORKFLOW_DIFF_VERSION,
        before,
        after,
        removedNodes,
        addedNodes,
        removedEdges,
        addedEdges,
        riskReduction,
        beforeRisk: before.riskScore,
        afterRisk: after.riskScore,
        executionPathRemoved,
        diffReason,
        comparison: {
            nodes: { removed: removedNodes, added: addedNodes },
            edges: { removed: removedEdges, added: addedEdges },
            privilegedSinks: { removed: removedSinks, added: addedSinks },
            trustBoundaries: {
                before: before.trustBoundaryCrossed,
                after: after.trustBoundaryCrossed,
                removed: trustBoundaryRemoved,
            },
            permissions: { removed: removedPermissions, added: addedPermissions },
        },
    };
}

// Convenience: build the before/after diff for an inferred finding workflow,
// using the deterministic hardened graph as the "after".
export function buildWorkflowDiff(workflow: FindingWorkflow): WorkflowDiff {
    const before = pathToGraph(workflow.path);
    const after = deriveRemediatedGraph(before);
    return computeWorkflowDiff(before, after);
}
