import type { Finding, Severity } from '../rules/types';
import type {
    FindingWorkflow,
    NodeProvenance,
    RootCauseAnalysis,
    WorkflowConfidenceLevel,
    WorkflowEvidence,
    WorkflowInferenceInput,
    WorkflowNode,
    WorkflowNodeType,
    WorkflowPath,
} from './types';

// ---------------------------------------------------------------------------
// Workflow Provenance Engine v1
//
// Turns the workflow path that the analyzer already inferred (from real rule
// matches) into a deterministic, evidence-backed provenance layer:
//
//   - Feature 1: WorkflowEvidence[]  — every item traces to a rule match / node.
//   - Feature 2: confidence score + level from fixed indicator weights.
//   - Feature 4: per-node provenance (evidence, confidence contribution, rules).
//
// There are NO LLM calls, NO randomness, and NO generated explanations here.
// Each indicator only fires when its concrete signal is present in the scanned
// text or in the inferred path, and every evidence `source` is a real substring
// or node type — never invented.
// ---------------------------------------------------------------------------

interface IndicatorDef {
    // Stable machine code, surfaced as a per-node "rule match".
    code: string;
    // Human-readable label shown as an evidence tag.
    label: string;
    // Fixed deterministic weight (see Feature 2 weight table).
    weight: number;
    // Node types this indicator is attributed to for per-node provenance.
    nodeTypes: WorkflowNodeType[];
    // Optional text probe. Matching substring becomes the evidence `source`.
    pattern?: RegExp;
    // Optional structural predicate over the already-inferred path.
    fromPath?: (path: WorkflowPath) => boolean;
}

// Strong / medium / weak indicators with the exact weights from the spec.
const INDICATORS: IndicatorDef[] = [
    // Strong indicators
    {
        code: 'autoExecute',
        label: 'autoExecute=true',
        weight: 25,
        nodeTypes: ['mcp_server', 'mcp_tool', 'privileged_tool'],
        pattern: /\bauto[-_\s]?execute\s*[:=]?\s*true\b|\bautoExecute\b|\bautomatic\s+execution\b/i,
    },
    {
        code: 'wildcard_permissions',
        label: 'permissions="*"',
        weight: 25,
        nodeTypes: ['mcp_server', 'mcp_tool', 'privileged_tool'],
        pattern: /"?permissions"?\s*[:=]\s*"?\*"?|\bwildcard\s+permissions?\b/i,
    },
    {
        code: 'shell_command',
        label: 'shell command detected',
        weight: 20,
        nodeTypes: ['shell_execution', 'tool_execution'],
        pattern: /\bshell_exec\b|\bbash\b|\brm\s+-rf\b|\bsubprocess\b|\bos\.system\b|\bexecute\s+(?:any\s+|all\s+)?(?:shell\s+)?commands?\b/i,
        fromPath: (p) => p.nodes.some((n) => n.type === 'shell_execution' || n.type === 'tool_execution'),
    },
    {
        code: 'privileged_sink',
        label: 'privileged sink reached',
        weight: 20,
        nodeTypes: ['shell_execution', 'tool_execution', 'privileged_tool', 'filesystem_access', 'network_access', 'credential_store', 'external_api'],
        fromPath: (p) => p.privilegedSinkReached,
    },
    {
        code: 'credential_propagation',
        label: 'credential propagation',
        weight: 10,
        nodeTypes: ['credential_store', 'secret'],
        pattern: /\bsk-[A-Za-z0-9_-]{6,}\b|\b(api[_-]?key|secret|token|password|bearer|credential)\b/i,
        fromPath: (p) => p.nodes.some((n) => n.type === 'credential_store' || n.type === 'secret'),
    },
    // Medium indicators
    {
        code: 'memory_persistence',
        label: 'memory persistence',
        weight: 10,
        nodeTypes: ['agent_memory'],
        pattern: /\bagent\s+memory\b|\bpersist\s+instructions?\b|\bretain\s+instructions?\b|\bfuture\s+sessions?\b/i,
        fromPath: (p) => p.nodes.some((n) => n.type === 'agent_memory'),
    },
    {
        code: 'tool_routing',
        label: 'tool routing',
        weight: 10,
        nodeTypes: ['tool_router', 'privileged_tool', 'mcp_tool'],
        pattern: /\btool[_\s-]?router\b/i,
        fromPath: (p) => p.nodes.some((n) => n.type === 'tool_router' || n.type === 'privileged_tool' || n.type === 'mcp_tool'),
    },
    {
        code: 'network_access',
        label: 'network access',
        weight: 10,
        nodeTypes: ['network_access', 'external_api'],
        pattern: /\bnetwork_access\b|\bexternal_api\b|\bwebhook\b|https?:\/\/\S+/i,
        fromPath: (p) => p.nodes.some((n) => n.type === 'network_access' || n.type === 'external_api'),
    },
    // Weak indicators
    {
        code: 'heuristic_match',
        label: 'heuristic match',
        weight: 5,
        nodeTypes: ['system_prompt', 'policy_override', 'user_input', 'untrusted_content'],
        pattern: /\bignore\s+(?:all\s+|previous\s+|prior\s+|earlier\s+)?(?:instructions?|restrictions?|rules?)\b|\boverride\s+instructions?\b|\brewrite\s+(?:the\s+)?system\s+prompt\b/i,
    },
];

function levelFor(score: number): WorkflowConfidenceLevel {
    if (score >= 80) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    return 'LOW';
}

interface FiredIndicator {
    def: IndicatorDef;
    source: string;
}

// Evaluate every indicator once against the scanned text and the inferred path.
function fireIndicators(haystack: string, path: WorkflowPath): FiredIndicator[] {
    const fired: FiredIndicator[] = [];
    for (const def of INDICATORS) {
        let source: string | undefined;
        if (def.pattern) {
            const m = haystack.match(def.pattern);
            if (m) source = m[0].trim().slice(0, 90);
        }
        if (!source && def.fromPath && def.fromPath(path)) {
            // Structural signal with no literal substring: use the node type as the source.
            const node = path.nodes.find((n) => def.nodeTypes.includes(n.type));
            source = node ? `${node.type} node inferred` : def.label;
        }
        if (source) fired.push({ def, source });
    }
    return fired;
}

export interface WorkflowProvenanceResult {
    confidenceScore: number;
    confidenceLevel: WorkflowConfidenceLevel;
    evidence: WorkflowEvidence[];
    labels: string[];
    perNode: Map<WorkflowNodeType, NodeProvenance>;
}

// Compute the full provenance layer for one inferred path.
export function computeWorkflowProvenance(
    input: WorkflowInferenceInput,
    path: WorkflowPath,
): WorkflowProvenanceResult {
    const haystack = [input.text, input.content || '', input.message || '', input.filePath || ''].join('\n');
    const fired = fireIndicators(haystack, path);

    const evidence: WorkflowEvidence[] = fired.map(({ def, source }) => ({
        id: `${input.ruleId}:${def.code}`,
        ruleId: input.ruleId,
        label: def.label,
        severity: input.severity,
        source,
    }));

    const confidenceScore = Math.max(0, Math.min(100, fired.reduce((sum, f) => sum + f.def.weight, 0)));
    const confidenceLevel = levelFor(confidenceScore);

    // Attribute each fired indicator to the first matching node in the path so
    // per-node contributions sum to a deterministic, non-double-counted total.
    const perNode = new Map<WorkflowNodeType, NodeProvenance>();
    const ensure = (type: WorkflowNodeType): NodeProvenance => {
        let p = perNode.get(type);
        if (!p) {
            p = { evidence: [], confidenceContribution: 0, ruleMatches: [] };
            perNode.set(type, p);
        }
        return p;
    };
    for (const { def, source } of fired) {
        const target = path.nodes.find((n) => def.nodeTypes.includes(n.type));
        if (!target) continue;
        const p = ensure(target.type);
        p.confidenceContribution += def.weight;
        p.ruleMatches.push(def.code);
        p.evidence.push({
            id: `${input.ruleId}:${def.code}`,
            ruleId: input.ruleId,
            label: def.label,
            severity: input.severity,
            source,
        });
    }

    return {
        confidenceScore,
        confidenceLevel,
        evidence,
        labels: evidence.map((e) => e.label),
        perNode,
    };
}

// Attach the provenance layer onto a freshly-built workflow (mutates and returns).
export function attachProvenance(workflow: FindingWorkflow, input: WorkflowInferenceInput): FindingWorkflow {
    const result = computeWorkflowProvenance(input, workflow.path);

    for (const node of workflow.path.nodes) {
        const p = result.perNode.get(node.type);
        if (p) node.provenance = p;
    }

    workflow.path.confidence_score = result.confidenceScore;
    workflow.path.confidence_level = result.confidenceLevel;
    workflow.path.workflow_evidence = result.labels;
    workflow.path.evidence = result.evidence;

    workflow.confidence_score = result.confidenceScore;
    workflow.confidence_level = result.confidenceLevel;
    workflow.workflow_evidence = result.labels;
    workflow.evidence = result.evidence;

    return workflow;
}

// Root-cause priority: the most upstream / most explanatory rule wins. Order is
// fixed and deterministic; ties fall back to severity then rule id.
const ROOT_CAUSE_PRIORITY = [
    'sec_mcp_tool_poisoning',
    'sec_workflow_escalation',
    'sec_privileged_sink_access',
    'sec_owasp_llm01_injection',
    'sec_rag_injection',
    'sec_unbounded_persona',
    'sec_unbounded_access',
    'sec_owasp_llm02_pii',
];

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Feature 3: group security findings under a single root cause. Findings are
// never removed — supportingFindings is simply the remainder.
export function analyzeRootCause(findings: Finding[]): RootCauseAnalysis | undefined {
    const security = findings.filter((f) => f.category === 'security');
    if (security.length === 0) return undefined;

    const sorted = [...security].sort((a, b) => {
        const pa = ROOT_CAUSE_PRIORITY.indexOf(a.rule_id);
        const pb = ROOT_CAUSE_PRIORITY.indexOf(b.rule_id);
        const ra = pa === -1 ? Number.MAX_SAFE_INTEGER : pa;
        const rb = pb === -1 ? Number.MAX_SAFE_INTEGER : pb;
        if (ra !== rb) return ra - rb;
        const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (sev !== 0) return sev;
        return a.rule_id.localeCompare(b.rule_id);
    });

    const [rootCause, ...supportingFindings] = sorted;
    return { rootCause, supportingFindings };
}
