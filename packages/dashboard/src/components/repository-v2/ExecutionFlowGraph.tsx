"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RepositoryExecutionNode,
  RepositoryExecutionNodeType,
  RepositoryRisk,
  RepositorySensitiveAction,
} from "@promptsonar/core";
import type { PathProjection } from "@/lib/repositoryViewModel";

/**
 * ExecutionFlowGraph — the scalable replacement for the fixed 3-column
 * ExecutionGraph. It never renders one node per file; instead it aggregates the
 * real scanned paths into a bounded set of *typed cluster nodes* (sources →
 * tool layer → sensitive actions) with counts and weighted edge bundles. This
 * looks identical whether the repository has 15 files or 5,000, while staying
 * honest: every bundle is backed by at least one real reachable path.
 *
 * Interactions:
 *  - hover any node → trace (dim everything not on a shared path)
 *  - click a sensitive action → sink-anchored focus (only paths reaching it)
 *  - on first reveal → staged scan animation (columns appear, edges draw,
 *    sinks ignite, counters count up), respecting prefers-reduced-motion.
 */

type RiskWeight = Record<RepositoryRisk, number>;
const RISK_RANK: RiskWeight = { critical: 4, high: 3, medium: 2, low: 1 };

const SOURCE_TYPES: RepositoryExecutionNodeType[] = ["PROMPT", "SKILL", "MEMORY", "WORKFLOW"];
const TOOL_TYPES: RepositoryExecutionNodeType[] = ["TOOL", "MCP_SERVER"];

const TYPE_LABELS: Record<RepositoryExecutionNodeType, string> = {
  PROMPT: "Prompts",
  SKILL: "Skills",
  MEMORY: "Memory",
  WORKFLOW: "Workflows",
  TOOL: "Tool routers",
  MCP_SERVER: "MCP servers",
  ACTION: "Sensitive actions",
};

const ACTION_ORDER: RepositorySensitiveAction[] = ["Filesystem", "Shell", "Network", "Secrets", "External APIs"];

// Layout. Heights are derived from the tallest column so the SVG never clips,
// regardless of how many cluster types are present.
const SVG_W = 940;
const NODE_W = 156;
const NODE_H = 48;
const ROW_SLOT = 72;
const PAD_Y = 26;
const COL_X = [38, 392, 746];

function riskColor(risk: RepositoryRisk): string {
  if (risk === "critical" || risk === "high") return "#ef4444";
  if (risk === "medium") return "#d97706";
  return "#78716c";
}

function worse(a: RepositoryRisk, b: RepositoryRisk): RepositoryRisk {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

type ClusterNode = {
  id: string;
  column: 0 | 1 | 2;
  kind: "source" | "tool" | "action";
  title: string;
  sub: string;
  count: number;
  worstRisk: RepositoryRisk;
  confirmed: number;
  pathIds: Set<string>;
};

type Bundle = {
  id: string;
  from: string;
  to: string;
  weight: number;
  worstRisk: RepositoryRisk;
  hasConfirmed: boolean;
  pathIds: Set<string>;
};

type GraphModel = {
  nodes: ClusterNode[];
  bundles: Bundle[];
  maxRows: number;
  actionNodes: ClusterNode[];
};

function sourceTypeOf(path: PathProjection): RepositoryExecutionNodeType | undefined {
  const fromSource = path.source?.type;
  if (fromSource && SOURCE_TYPES.includes(fromSource)) return fromSource;
  return path.nodes.find((node) => SOURCE_TYPES.includes(node.type))?.type;
}

function toolNodeOf(path: PathProjection): RepositoryExecutionNode | undefined {
  return path.nodes.find((node) => TOOL_TYPES.includes(node.type));
}

function buildModel(paths: PathProjection[]): GraphModel {
  const nodes = new Map<string, ClusterNode>();
  const bundles = new Map<string, Bundle>();

  const ensureNode = (id: string, base: Omit<ClusterNode, "pathIds" | "count" | "worstRisk" | "confirmed">) => {
    let node = nodes.get(id);
    if (!node) {
      node = { ...base, count: 0, worstRisk: "low", confirmed: 0, pathIds: new Set() };
      nodes.set(id, node);
    }
    return node;
  };

  const ensureBundle = (from: string, to: string) => {
    const id = `${from}->${to}`;
    let bundle = bundles.get(id);
    if (!bundle) {
      bundle = { id, from, to, weight: 0, worstRisk: "low", hasConfirmed: false, pathIds: new Set() };
      bundles.set(id, bundle);
    }
    return bundle;
  };

  // Track distinct artifacts per cluster so counts read "47 prompts" honestly.
  const sourceArtifacts = new Map<string, Set<string>>();
  const toolArtifacts = new Map<string, Set<string>>();

  for (const path of paths) {
    const action = path.action;
    if (!action) continue;
    const sourceType = sourceTypeOf(path);
    if (!sourceType) continue;
    const tool = toolNodeOf(path);
    const risk = path.risk;
    const isConfirmed = path.confidence === "confirmed";

    const sourceId = `src:${sourceType}`;
    const actionId = `act:${action}`;
    const toolId = tool ? `tool:${tool.type}` : undefined;

    const sourceNode = ensureNode(sourceId, {
      id: sourceId, column: 0, kind: "source", title: TYPE_LABELS[sourceType], sub: "Instruction source",
    });
    const actionNode = ensureNode(actionId, {
      id: actionId, column: 2, kind: "action", title: action, sub: "Sensitive action",
    });

    const sourceKey = path.source?.id || path.nodes.find((n) => n.type === sourceType)?.id || sourceId;
    if (!sourceArtifacts.has(sourceId)) sourceArtifacts.set(sourceId, new Set());
    sourceArtifacts.get(sourceId)!.add(sourceKey);

    for (const node of [sourceNode, actionNode]) {
      node.pathIds.add(path.id);
      node.worstRisk = worse(node.worstRisk, risk);
      if (isConfirmed) node.confirmed += 1;
    }
    // Action count is path-weighted (how many routes reach it); source count is
    // distinct-artifact-weighted (how many instruction files exist).
    actionNode.count += 1;

    if (toolId && tool) {
      const toolNode = ensureNode(toolId, {
        id: toolId, column: 1, kind: "tool", title: TYPE_LABELS[tool.type], sub: "Tool layer",
      });
      toolNode.pathIds.add(path.id);
      toolNode.worstRisk = worse(toolNode.worstRisk, risk);
      if (isConfirmed) toolNode.confirmed += 1;
      if (!toolArtifacts.has(toolId)) toolArtifacts.set(toolId, new Set());
      toolArtifacts.get(toolId)!.add(tool.id);

      for (const [from, to] of [[sourceId, toolId], [toolId, actionId]] as const) {
        const bundle = ensureBundle(from, to);
        bundle.weight += 1;
        bundle.worstRisk = worse(bundle.worstRisk, risk);
        bundle.hasConfirmed = bundle.hasConfirmed || isConfirmed;
        bundle.pathIds.add(path.id);
      }
    } else {
      const bundle = ensureBundle(sourceId, actionId);
      bundle.weight += 1;
      bundle.worstRisk = worse(bundle.worstRisk, risk);
      bundle.hasConfirmed = bundle.hasConfirmed || isConfirmed;
      bundle.pathIds.add(path.id);
    }
  }

  for (const [id, set] of sourceArtifacts) nodes.get(id)!.count = set.size;
  for (const [id, set] of toolArtifacts) nodes.get(id)!.count = set.size;

  const allNodes = Array.from(nodes.values());
  const byCol = (col: number) => allNodes.filter((n) => n.column === col);
  const maxRows = Math.max(byCol(0).length, byCol(1).length, byCol(2).length, 1);
  const actionNodes = byCol(2).sort(
    (a, b) => ACTION_ORDER.indexOf(a.title as RepositorySensitiveAction) - ACTION_ORDER.indexOf(b.title as RepositorySensitiveAction),
  );

  return { nodes: allNodes, bundles: Array.from(bundles.values()), maxRows, actionNodes };
}

function layoutColumn(nodes: ClusterNode[], maxRows: number) {
  const svgH = PAD_Y * 2 + maxRows * ROW_SLOT;
  const positions = new Map<string, { x: number; y: number }>();
  for (const col of [0, 1, 2]) {
    const colNodes = nodes
      .filter((n) => n.column === col)
      .sort((a, b) => RISK_RANK[b.worstRisk] - RISK_RANK[a.worstRisk] || a.title.localeCompare(b.title));
    const startY = (svgH - colNodes.length * ROW_SLOT) / 2;
    colNodes.forEach((node, index) => {
      positions.set(node.id, { x: COL_X[col], y: startY + index * ROW_SLOT + (ROW_SLOT - NODE_H) / 2 });
    });
  }
  return { positions, svgH };
}

const REVEAL_PHASES = [
  "Indexing files",
  "Extracting prompts & skills",
  "Tracing tool routes",
  "Confirming sink reachability",
];

function useCountUp(target: number, run: boolean) {
  const [value, setValue] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

export function ExecutionFlowGraph({ paths, scanId }: { paths: PathProjection[]; scanId?: string }) {
  const model = useMemo(() => buildModel(paths), [paths]);
  const { positions, svgH } = useMemo(() => layoutColumn(model.nodes, model.maxRows), [model]);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [phase, setPhase] = useState(0);
  const [animate, setAnimate] = useState(false);
  const edgeRefs = useRef<Map<string, SVGPathElement>>(new Map());

  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion:reduce)").matches;

  // Staged reveal whenever a new scan loads.
  useEffect(() => {
    if (reducedMotion || model.bundles.length === 0) {
      setAnimate(false);
      setPhase(REVEAL_PHASES.length);
      return;
    }
    setAnimate(true);
    setPhase(0);
    setFocusId(null);
    const timers = REVEAL_PHASES.map((_, index) =>
      window.setTimeout(() => setPhase(index + 1), 380 * (index + 1)),
    );
    // Draw the edge bundles in once the routing phase begins.
    const drawTimer = window.setTimeout(() => {
      const ordered = [...model.bundles].sort((a, b) => b.weight - a.weight);
      ordered.forEach((bundle, index) => {
        const path = edgeRefs.current.get(bundle.id);
        if (!path) return;
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
          duration: 650,
          delay: index * 120,
          fill: "forwards",
          easing: "ease-out",
        });
      });
    }, 760);
    const endTimer = window.setTimeout(() => setAnimate(false), 380 * REVEAL_PHASES.length + model.bundles.length * 120 + 700);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(drawTimer);
      clearTimeout(endTimer);
    };
  }, [scanId, model, reducedMotion]);

  const activeId = hoverId ?? focusId;
  const activePathIds = useMemo(() => {
    if (!activeId) return null;
    const node = model.nodes.find((n) => n.id === activeId);
    const bundle = model.bundles.find((b) => b.id === activeId);
    return (node?.pathIds ?? bundle?.pathIds) ?? null;
  }, [activeId, model]);

  const intersects = (ids: Set<string>) => {
    if (!activePathIds) return true;
    for (const id of ids) if (activePathIds.has(id)) return true;
    return false;
  };

  const focusedAction = focusId ? model.actionNodes.find((n) => n.id === focusId) : null;

  if (model.bundles.length === 0) {
    return (
      <div className="rounded-[20px] border border-emerald-600/25 bg-emerald-50/45 p-6 text-[13px] text-emerald-900">
        No reachable sensitive-action paths were found in the scanned artifacts. There is no execution flow to a sensitive
        action to display.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-white/70 bg-white/65 p-3 shadow-[0_22px_65px_-46px_rgba(28,25,23,0.7)] backdrop-blur-xl sm:p-4">
      {/* Scan reveal strip */}
      <div className="flex items-center gap-2 px-2 pb-3 pt-1 font-mono text-[10px] uppercase tracking-[0.12em]">
        {REVEAL_PHASES.map((label, index) => {
          const done = phase > index;
          const current = phase === index && animate;
          return (
            <span
              key={label}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors duration-300 ${
                done ? "border-stone-900/15 bg-white text-stone-700" : current ? "border-amber-500/40 bg-amber-50 text-amber-700" : "border-stone-900/10 bg-white/40 text-stone-400"
              }`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-500" : current ? "bg-amber-500 animate-pulse" : "bg-stone-300"}`} />
              {label}
            </span>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${svgH}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Aggregated execution flow from instruction sources to sensitive actions"
      >
        {/* Column captions */}
        {(["Instruction sources", "Tool layer", "Sensitive actions"] as const).map((caption, col) => (
          <text
            key={caption}
            x={COL_X[col] + NODE_W / 2}
            y={14}
            textAnchor="middle"
            style={{ fontFamily: "Geist Mono, monospace", fontSize: 9, letterSpacing: "0.12em", fill: "#a8a29e", textTransform: "uppercase" }}
          >
            {caption}
          </text>
        ))}

        {/* Bundles */}
        {model.bundles.map((bundle) => {
          const s = positions.get(bundle.from);
          const t = positions.get(bundle.to);
          if (!s || !t) return null;
          const x1 = s.x + NODE_W;
          const y1 = s.y + NODE_H / 2;
          const x2 = t.x;
          const y2 = t.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const lit = intersects(bundle.pathIds);
          const width = Math.min(7, 1.2 + Math.log2(bundle.weight + 1) * 1.25);
          const color = bundle.hasConfirmed ? "#ef4444" : riskColor(bundle.worstRisk);
          return (
            <path
              key={bundle.id}
              ref={(el) => {
                if (el) edgeRefs.current.set(bundle.id, el);
              }}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={lit ? width + 0.8 : width}
              strokeLinecap="round"
              opacity={activeId && !lit ? 0.12 : bundle.hasConfirmed ? 0.95 : 0.5}
              style={{
                transition: "opacity 200ms ease, stroke-width 200ms ease",
                filter: bundle.hasConfirmed && lit ? "drop-shadow(0 1px 4px rgba(239,68,68,0.35))" : undefined,
                cursor: "pointer",
              }}
              onMouseEnter={() => setHoverId(bundle.id)}
              onMouseLeave={() => setHoverId(null)}
            />
          );
        })}

        {/* Nodes */}
        {model.nodes.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            pos={positions.get(node.id)!}
            dim={Boolean(activeId) && !intersects(node.pathIds)}
            focused={focusId === node.id}
            animateCounts={animate}
            onEnter={() => setHoverId(node.id)}
            onLeave={() => setHoverId(null)}
            onClick={node.kind === "action" ? () => setFocusId((cur) => (cur === node.id ? null : node.id)) : undefined}
          />
        ))}
      </svg>

      {/* Caption + legend */}
      <div className="flex flex-col gap-2 px-3 pb-1 pt-2">
        {focusedAction ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50/70 px-3 py-2 text-[12px] text-red-900">
            <b>{focusedAction.count.toLocaleString()}</b> route{focusedAction.count === 1 ? "" : "s"} · worst risk
            <span className="font-semibold capitalize">{focusedAction.worstRisk}</span> reach <b>{focusedAction.title}</b>.
            <button type="button" onClick={() => setFocusId(null)} className="ml-auto rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-red-50">
              Clear focus
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-stone-500">
            Aggregated from <b className="text-stone-700">{paths.length.toLocaleString()}</b> reachable path{paths.length === 1 ? "" : "s"}.
            Hover a node to trace its routes; click a sensitive action to focus only the paths reaching it.
          </p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-stone-500">
          <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 bg-danger-500" /> Confirmed route</span>
          <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 bg-amber-600" /> Probable / medium</span>
          <span className="flex items-center gap-2"><span className="inline-block h-0.5 w-5 bg-stone-400" /> Possible route</span>
          <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full border border-danger-line bg-danger-soft" /> Sensitive action · click to focus</span>
        </div>
      </div>
    </div>
  );
}

function GraphNode({
  node,
  pos,
  dim,
  focused,
  animateCounts,
  onEnter,
  onLeave,
  onClick,
}: {
  node: ClusterNode;
  pos: { x: number; y: number };
  dim: boolean;
  focused: boolean;
  animateCounts: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick?: () => void;
}) {
  const count = useCountUp(node.count, animateCounts);
  const isAction = node.kind === "action";
  const hot = node.worstRisk === "critical" || node.worstRisk === "high";
  const stroke = focused ? "#b91c1c" : hot ? "#ef4444" : isAction ? "rgba(244,180,172,0.95)" : "rgba(231,229,228,0.95)";
  return (
    <g
      style={{ cursor: onClick ? "pointer" : "default", opacity: dim ? 0.4 : 1, transition: "opacity 200ms ease" }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      <rect
        x={pos.x}
        y={pos.y}
        width={NODE_W}
        height={NODE_H}
        rx={11}
        fill={isAction ? "rgba(254,232,228,0.9)" : "rgba(255,255,255,0.92)"}
        stroke={stroke}
        strokeWidth={focused || hot ? 1.7 : 1.1}
        style={{ filter: "drop-shadow(0 5px 14px rgba(28,25,23,0.1))" }}
      />
      <text x={pos.x + 15} y={pos.y + 18} style={{ fontFamily: "Geist Mono, monospace", fontSize: 8.5, letterSpacing: "0.1em", fill: "#9a948c", textTransform: "uppercase" }}>
        {node.sub}
      </text>
      <text x={pos.x + 15} y={pos.y + 34} style={{ fontFamily: "Geist Mono, monospace", fontSize: 13, fontWeight: 500, fill: isAction ? "#a51d1d" : "#1c1917" }}>
        {node.title}
      </text>
      <text x={pos.x + NODE_W - 14} y={pos.y + 30} textAnchor="end" style={{ fontFamily: "Geist Mono, monospace", fontSize: 15, fontWeight: 600, fill: hot ? "#b91c1c" : "#57534e" }}>
        {count.toLocaleString()}
      </text>
    </g>
  );
}

export default ExecutionFlowGraph;
