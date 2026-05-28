"use client";

import React, { useMemo, useState } from "react";

type Trust =
  | "trusted"
  | "semi_trusted"
  | "untrusted"
  | "privileged"
  | "unknown";

type Confidence = "low" | "medium" | "high";

type NodeType =
  | "user_input"
  | "untrusted_content"
  | "system_prompt"
  | "developer_prompt"
  | "prompt_template"
  | "agent_memory"
  | "retrieved_context"
  | "rag_context"
  | "mcp_server"
  | "mcp_tool"
  | "privileged_tool"
  | "tool_router"
  | "tool_execution"
  | "shell_execution"
  | "network_access"
  | "filesystem_access"
  | "credential_store"
  | "external_api"
  | "policy_override"
  | "secret"
  | "unknown";

interface WorkflowNode {
  id?: string;
  label?: string;
  type: NodeType | string;
  trust?: Trust | string;
  confidence?: Confidence | string;
  reason?: string;
  evidence?: string;
  tainted?: boolean;
  privilegePropagated?: boolean;
}

interface WorkflowEdge {
  from?: string;
  to?: string;
  type?: string;
  reason?: string;
  risk?: string;
  confidence?: string;
  tainted?: boolean;
  privilegePropagated?: boolean;
}

export interface WorkflowGraphData {
  path?: {
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    trustBoundaryCrossed?: boolean;
    privilegedSinkReached?: boolean;
    riskStory?: string;
    summary?: string;
    confidence?: string;
  };
  risk?: string;
  confidence?: string;
}

export interface WorkflowGraphProps {
  workflow?: WorkflowGraphData | null;
  compact?: boolean;
  maxVisibleNodes?: number;
  className?: string;
  emptyMessage?: string;
}

interface DisplayNode extends WorkflowNode {
  __collapsed?: false;
  __displayRole: "source" | "sink" | "boundary" | "middle";
}

interface CollapsedGroup {
  __collapsed: true;
  count: number;
  nodes: WorkflowNode[];
}

type DisplayItem = DisplayNode | CollapsedGroup;

const TYPE_LABEL: Record<string, string> = {
  user_input: "User input",
  untrusted_content: "Untrusted content",
  system_prompt: "System prompt",
  developer_prompt: "Developer prompt",
  prompt_template: "Prompt template",
  agent_memory: "Agent memory",
  retrieved_context: "Retrieved context",
  rag_context: "RAG context",
  mcp_server: "MCP server",
  mcp_tool: "MCP tool",
  privileged_tool: "Privileged tool",
  tool_router: "Tool router",
  tool_execution: "Tool execution",
  shell_execution: "Shell execution",
  network_access: "Network access",
  filesystem_access: "Filesystem access",
  credential_store: "Credential store",
  external_api: "External API",
  policy_override: "Policy override",
  secret: "Secret",
  unknown: "Unknown",
};

function humanType(type: string): string {
  return TYPE_LABEL[type] || type.replace(/_/g, " ");
}

function humanEdgeType(type?: string): string {
  if (!type) return "flow";
  return type.replace(/_/g, " ");
}

function humanTrust(trust?: string): string {
  if (!trust) return "unknown";
  return trust.replace(/_/g, "-");
}

function confidenceDots(confidence?: string): number {
  const c = (confidence || "medium").toLowerCase();
  if (c === "high") return 3;
  if (c === "medium") return 2;
  return 1;
}

interface NodePalette {
  border: string;
  bg: string;
  text: string;
  ring: string;
  // Glyph color for the small role marker
  marker: string;
}

function paletteFor(node: WorkflowNode, role: DisplayNode["__displayRole"]): NodePalette {
  // Privileged sink: strong red
  if (role === "sink" || node.trust === "privileged") {
    return {
      border: "border-rose-300",
      bg: "bg-rose-50",
      text: "text-rose-900",
      ring: "ring-rose-200",
      marker: "bg-rose-500",
    };
  }
  // Credential store: amber/red hybrid
  if (node.type === "credential_store" || node.type === "secret") {
    return {
      border: "border-amber-300",
      bg: "bg-amber-50",
      text: "text-amber-900",
      ring: "ring-amber-200",
      marker: "bg-amber-500",
    };
  }
  // MCP / tool router: indigo
  if (
    node.type === "mcp_server" ||
    node.type === "mcp_tool" ||
    node.type === "tool_router" ||
    node.type === "privileged_tool" ||
    node.type === "tool_execution"
  ) {
    return {
      border: "border-indigo-200",
      bg: "bg-indigo-50/70",
      text: "text-indigo-900",
      ring: "ring-indigo-100",
      marker: "bg-indigo-500",
    };
  }
  // Untrusted source: amber
  if (role === "source" || node.trust === "untrusted") {
    return {
      border: "border-amber-200",
      bg: "bg-amber-50",
      text: "text-amber-900",
      ring: "ring-amber-100",
      marker: "bg-amber-500",
    };
  }
  // Semi-trusted: muted violet/blue
  if (node.trust === "semi_trusted") {
    return {
      border: "border-violet-200",
      bg: "bg-violet-50/70",
      text: "text-violet-900",
      ring: "ring-violet-100",
      marker: "bg-violet-400",
    };
  }
  // Trusted: neutral slate
  return {
    border: "border-slate-200",
    bg: "bg-white",
    text: "text-slate-800",
    ring: "ring-slate-100",
    marker: "bg-slate-400",
  };
}

function classifyDisplayRole(
  index: number,
  total: number,
  node: WorkflowNode,
): DisplayNode["__displayRole"] {
  if (index === 0) return "source";
  if (index === total - 1) return "sink";
  if (node.trust === "semi_trusted" || node.trust === "trusted") return "boundary";
  return "middle";
}

/**
 * Reduce a long node sequence to ≤ maxVisibleNodes by collapsing low-value
 * middle nodes into a single "+N steps" placeholder. Always preserves the
 * source, the sink, and any trust-boundary or privilege-propagated nodes.
 */
function simplifyNodes(
  nodes: WorkflowNode[],
  maxVisibleNodes: number,
): DisplayItem[] {
  if (nodes.length === 0) return [];
  if (nodes.length <= maxVisibleNodes) {
    return nodes.map((n, i) => ({
      ...n,
      __displayRole: classifyDisplayRole(i, nodes.length, n),
    }));
  }

  const lastIndex = nodes.length - 1;
  const keepIndices = new Set<number>([0, lastIndex]);

  // Preserve trust-boundary transitions
  for (let i = 1; i < lastIndex; i++) {
    const prev = nodes[i - 1];
    const cur = nodes[i];
    if (
      cur.trust === "privileged" ||
      cur.privilegePropagated ||
      (prev && prev.trust !== cur.trust)
    ) {
      keepIndices.add(i);
    }
  }

  // If still over budget, drop interior privilege-only nodes until we fit
  const ordered = Array.from(keepIndices).sort((a, b) => a - b);
  while (ordered.length > maxVisibleNodes) {
    // Drop the middle entry (not 0 or lastIndex)
    const middle = ordered.slice(1, -1);
    if (middle.length === 0) break;
    const dropIdx = middle[Math.floor(middle.length / 2)];
    const at = ordered.indexOf(dropIdx);
    ordered.splice(at, 1);
  }

  const out: DisplayItem[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const idx = ordered[i];
    const node = nodes[idx];
    out.push({
      ...node,
      __displayRole: classifyDisplayRole(idx, nodes.length, node),
    });
    const next = ordered[i + 1];
    if (next !== undefined && next - idx > 1) {
      const skipped = nodes.slice(idx + 1, next);
      out.push({
        __collapsed: true,
        count: skipped.length,
        nodes: skipped,
      });
    }
  }
  return out;
}

interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  dashArray?: string;
  arrow: string;
  tone: "default" | "tainted" | "boundary" | "privileged";
}

function styleForEdge(
  from: WorkflowNode | undefined,
  to: WorkflowNode | undefined,
  edge: WorkflowEdge | undefined,
): EdgeStyle {
  // Privileged propagation overrides
  const privileged =
    edge?.privilegePropagated ||
    to?.trust === "privileged" ||
    edge?.type === "permission_flow";
  if (privileged) {
    return {
      stroke: "#e11d48", // rose-600
      strokeWidth: 2,
      arrow: "#e11d48",
      tone: "privileged",
    };
  }
  // Trust boundary (dashed)
  if (
    edge?.type === "trust_boundary" ||
    (from && to && from.trust !== to.trust && from.trust && to.trust)
  ) {
    return {
      stroke: "#f59e0b", // amber-500
      strokeWidth: 1.75,
      dashArray: "5 4",
      arrow: "#f59e0b",
      tone: "boundary",
    };
  }
  // Tainted (highlighted)
  if (edge?.tainted || from?.tainted || to?.tainted) {
    return {
      stroke: "#d97706", // amber-600
      strokeWidth: 1.75,
      arrow: "#d97706",
      tone: "tainted",
    };
  }
  // Normal
  return {
    stroke: "#cbd5e1", // slate-300
    strokeWidth: 1.5,
    arrow: "#94a3b8",
    tone: "default",
  };
}

/**
 * Tiny inline connector — fixed width SVG between two nodes. Renders a
 * straight line with arrowhead and a short edge label above. Deterministic,
 * no layout math required.
 */
const Connector: React.FC<{
  style: EdgeStyle;
  label?: string;
  showBoundary?: boolean;
  compact?: boolean;
}> = ({ style, label, showBoundary, compact }) => {
  const width = compact ? 36 : 56;
  const height = 36;
  return (
    <div
      className="relative flex shrink-0 flex-col items-center justify-center px-0.5"
      aria-hidden="true"
    >
      {label && !compact && (
        <span
          className={`mb-0.5 max-w-[80px] truncate rounded-full border bg-white px-1.5 py-[1px] text-[8.5px] font-bold uppercase tracking-wider ${
            style.tone === "privileged"
              ? "border-rose-200 text-rose-700"
              : style.tone === "boundary"
              ? "border-amber-200 text-amber-700"
              : style.tone === "tainted"
              ? "border-amber-200 text-amber-700"
              : "border-slate-200 text-slate-500"
          }`}
        >
          {label}
        </span>
      )}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="presentation"
      >
        <defs>
          <marker
            id={`ws-arrow-${style.tone}`}
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={style.arrow} />
          </marker>
        </defs>
        <line
          x1={2}
          y1={height / 2}
          x2={width - 4}
          y2={height / 2}
          stroke={style.stroke}
          strokeWidth={style.strokeWidth}
          strokeDasharray={style.dashArray}
          strokeLinecap="round"
          markerEnd={`url(#ws-arrow-${style.tone})`}
        />
        {showBoundary && (
          <line
            x1={width / 2}
            y1={2}
            x2={width / 2}
            y2={height - 2}
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
          />
        )}
      </svg>
      {showBoundary && !compact && (
        <span className="mt-0.5 text-[7.5px] font-black uppercase tracking-widest text-amber-700">
          Trust boundary
        </span>
      )}
    </div>
  );
};

const RoleBadge: React.FC<{ role: DisplayNode["__displayRole"] }> = ({ role }) => {
  const label =
    role === "source"
      ? "Untrusted source"
      : role === "sink"
      ? "Privileged sink"
      : role === "boundary"
      ? "Trust boundary"
      : "Workflow node";
  return (
    <span className="text-[8.5px] font-black uppercase tracking-widest opacity-70">
      {label}
    </span>
  );
};

const ConfidenceDots: React.FC<{ confidence?: string }> = ({ confidence }) => {
  const filled = confidenceDots(confidence);
  return (
    <span
      className="inline-flex items-center gap-[2px]"
      aria-label={`Confidence ${confidence || "medium"}`}
      title={`Confidence: ${(confidence || "medium").toUpperCase()}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < filled ? "bg-slate-500" : "bg-slate-200"
          }`}
        />
      ))}
    </span>
  );
};

const NodeCard: React.FC<{
  node: DisplayNode;
  active: boolean;
  compact: boolean;
  onFocus: () => void;
  onBlur: () => void;
}> = ({ node, active, compact, onFocus, onBlur }) => {
  const palette = paletteFor(node, node.__displayRole);
  const isPrivileged = node.__displayRole === "sink" || node.trust === "privileged";

  return (
    <button
      type="button"
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={`${humanType(node.type)}, trust ${humanTrust(
        node.trust,
      )}, confidence ${(node.confidence || "medium").toUpperCase()}${
        node.tainted ? ", tainted" : ""
      }${node.privilegePropagated ? ", privilege propagated" : ""}`}
      className={`group relative shrink-0 cursor-default rounded-xl border ${palette.border} ${palette.bg} ${palette.text} px-3 py-2 text-left shadow-3xs ring-1 ${palette.ring} transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        active ? "ring-2" : ""
      } ${compact ? "min-w-[120px] max-w-[160px]" : "min-w-[150px] max-w-[180px]"}`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${palette.marker}`}
          aria-hidden="true"
        />
        <RoleBadge role={node.__displayRole} />
      </div>
      <div
        className={`mt-1 truncate font-mono text-[11.5px] font-black ${
          isPrivileged ? "text-rose-900" : ""
        }`}
        title={humanType(node.type)}
      >
        {humanType(node.type)}
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider opacity-70">
        {humanTrust(node.trust)}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <ConfidenceDots confidence={node.confidence} />
        {node.tainted && (
          <span
            className="rounded border border-amber-300 bg-white/70 px-1.5 py-[1px] text-[8px] font-black uppercase tracking-wider text-amber-700"
            title="Untrusted content propagates through this node"
          >
            Tainted
          </span>
        )}
        {node.privilegePropagated && !isPrivileged && (
          <span
            className="rounded border border-rose-300 bg-white/70 px-1.5 py-[1px] text-[8px] font-black uppercase tracking-wider text-rose-700"
            title="Privilege propagates through this node"
          >
            Privilege
          </span>
        )}
      </div>
    </button>
  );
};

const CollapsedCard: React.FC<{
  group: CollapsedGroup;
  onExpand: () => void;
  compact: boolean;
}> = ({ group, onExpand, compact }) => {
  const summary = group.nodes
    .map((n) => humanType(n.type))
    .join(" → ");
  return (
    <button
      type="button"
      onClick={onExpand}
      title={summary}
      aria-label={`${group.count} intermediate workflow steps collapsed. ${summary}. Click to expand.`}
      className={`shrink-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-2.5 py-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        compact ? "min-w-[60px]" : "min-w-[72px]"
      }`}
    >
      <div className="text-[8.5px] font-black uppercase tracking-widest text-slate-400">
        Collapsed
      </div>
      <div className="mt-1 font-mono text-[11px] font-black">
        +{group.count} {group.count === 1 ? "step" : "steps"}
      </div>
      <div className="mt-1 text-[8.5px] font-bold uppercase tracking-wider text-slate-400">
        Show
      </div>
    </button>
  );
};

export const WorkflowGraph: React.FC<WorkflowGraphProps> = ({
  workflow,
  compact = false,
  maxVisibleNodes = 6,
  className,
  emptyMessage = "No high-confidence source-to-sink execution path inferred.",
}) => {
  const [expandedAll, setExpandedAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [showRawPath, setShowRawPath] = useState(false);

  const rawNodes = workflow?.path?.nodes ?? [];
  const rawEdges = workflow?.path?.edges ?? [];

  const items: DisplayItem[] = useMemo(() => {
    if (rawNodes.length === 0) return [];
    if (expandedAll) {
      return rawNodes.map((n, i) => ({
        ...n,
        __displayRole: classifyDisplayRole(i, rawNodes.length, n),
      }));
    }
    return simplifyNodes(rawNodes, Math.max(3, maxVisibleNodes));
  }, [rawNodes, expandedAll, maxVisibleNodes]);

  if (!workflow || rawNodes.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-6 text-center text-sm font-semibold text-slate-500 ${
          className || ""
        }`}
        role="status"
      >
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Workflow graph
        </div>
        <p className="mt-1 text-[12px] font-semibold leading-relaxed text-slate-600">
          {emptyMessage}
        </p>
      </div>
    );
  }

  // Build edges keyed by node-id pairs for label lookup
  const edgeMap = new Map<string, WorkflowEdge>();
  rawEdges.forEach((e) => {
    if (e.from && e.to) edgeMap.set(`${e.from}::${e.to}`, e);
  });

  // For collapsed sequences we need to know what edge crosses the gap:
  // use the edge from the last visible node before the gap to the first
  // visible node after, if present; otherwise fall back to the edge entering
  // the next visible node.
  function edgeBetween(
    leftNode: WorkflowNode | undefined,
    rightNode: WorkflowNode | undefined,
  ): WorkflowEdge | undefined {
    if (!leftNode || !rightNode) return undefined;
    const direct = edgeMap.get(`${leftNode.id}::${rightNode.id}`);
    if (direct) return direct;
    // fall back to the edge whose `to` matches rightNode.id
    return rawEdges.find((e) => e.to === rightNode.id);
  }

  const path = workflow.path || {};
  const totalNodes = rawNodes.length;
  const collapsedCount = items.filter(
    (i) => (i as CollapsedGroup).__collapsed,
  ).length;

  return (
    <div className={`flex flex-col gap-3 ${className || ""}`}>
      {/* Legend / header strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-slate-500">
        <div className="flex flex-wrap items-center gap-2 uppercase tracking-wider">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Untrusted
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
            Semi-trusted
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Tool / MCP
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            Privileged
          </span>
        </div>
        <div className="flex items-center gap-3">
          {totalNodes > items.filter((i) => !(i as CollapsedGroup).__collapsed).length && (
            <button
              type="button"
              onClick={() => setExpandedAll((v) => !v)}
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {expandedAll ? "Collapse path" : `Expand all (${totalNodes})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowRawPath((v) => !v)}
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-expanded={showRawPath}
          >
            {showRawPath ? "Hide raw path" : "View raw path"}
          </button>
        </div>
      </div>

      {/* Graph row */}
      <div
        className="-mx-1 overflow-x-auto px-1 pb-2 scrollbar-none"
        role="group"
        aria-label="Inferred execution path from untrusted source to privileged sink"
      >
        <ol className="flex items-stretch gap-1 sm:gap-1.5">
          {items.map((item, index) => {
            const isCollapsed = (item as CollapsedGroup).__collapsed === true;
            const nextItem = items[index + 1];

            // Resolve the "left" and "right" actual node for the connector
            const leftNode: WorkflowNode | undefined = isCollapsed
              ? (item as CollapsedGroup).nodes[
                  (item as CollapsedGroup).nodes.length - 1
                ]
              : (item as DisplayNode);
            const rightNode: WorkflowNode | undefined = nextItem
              ? (nextItem as CollapsedGroup).__collapsed
                ? (nextItem as CollapsedGroup).nodes[0]
                : (nextItem as DisplayNode)
              : undefined;

            const edge = edgeBetween(leftNode, rightNode);
            const edgeStyle = styleForEdge(leftNode, rightNode, edge);
            const trustChange =
              !!leftNode &&
              !!rightNode &&
              !!leftNode.trust &&
              !!rightNode.trust &&
              leftNode.trust !== rightNode.trust;

            return (
              <li key={index} className="flex items-stretch gap-1 sm:gap-1.5">
                {isCollapsed ? (
                  <CollapsedCard
                    group={item as CollapsedGroup}
                    onExpand={() => setExpandedAll(true)}
                    compact={compact}
                  />
                ) : (
                  <NodeCard
                    node={item as DisplayNode}
                    active={activeIndex === index}
                    compact={compact}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() =>
                      setActiveIndex((cur) => (cur === index ? null : cur))
                    }
                  />
                )}
                {nextItem && (
                  <Connector
                    style={edgeStyle}
                    label={humanEdgeType(edge?.type)}
                    showBoundary={trustChange}
                    compact={compact}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Active node detail (lightweight, no modal) */}
      {activeIndex !== null &&
        !(items[activeIndex] as CollapsedGroup)?.__collapsed && (() => {
          const node = items[activeIndex] as DisplayNode;
          return (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-black text-slate-900">
                  {humanType(node.type)}
                </span>
                <span className="rounded-full border border-slate-200 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  {humanTrust(node.trust)}
                </span>
                <span className="rounded-full border border-slate-200 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-slate-500">
                  Confidence {(node.confidence || "medium").toUpperCase()}
                </span>
              </div>
              {node.reason && (
                <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-slate-600">
                  {node.reason}
                </p>
              )}
              {node.evidence && (
                <p
                  className="mt-1 truncate font-mono text-[10.5px] text-slate-500"
                  title={node.evidence}
                >
                  ↪ {node.evidence}
                </p>
              )}
            </div>
          );
        })()}

      {/* Footer summary chips */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-500">
        {path.trustBoundaryCrossed && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
            Trust boundary crossed
          </span>
        )}
        {path.privilegedSinkReached && (
          <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-800">
            Privileged sink reached
          </span>
        )}
        {collapsedCount > 0 && !expandedAll && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-600">
            {collapsedCount === 1
              ? "1 intermediate step collapsed"
              : `${collapsedCount} intermediate groups collapsed`}
          </span>
        )}
      </div>

      {/* Raw path text (fallback / accessibility) */}
      {showRawPath && (
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[10.5px] text-slate-700">
          {rawNodes.map((n) => humanType(n.type)).join("  →  ")}
        </pre>
      )}
    </div>
  );
};

export default WorkflowGraph;
