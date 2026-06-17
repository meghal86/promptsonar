"use client";

import { useEffect, useRef } from "react";
import type { GraphData } from "@/types/repository";

const SVG_W = 900,
  SVG_H = 430;
const NODE_W = 158,
  NODE_H = 42;
const COL_X = [34, 372, 708];
const PAD_TOP = 18;
const ROW_GAP = (SVG_H - PAD_TOP * 2 - NODE_H) / 4;

const NS = "http://www.w3.org/2000/svg";
function svgEl<T extends SVGElement>(
  tag: string,
  attrs: Record<string, string>,
): T {
  const el = document.createElementNS(NS, tag) as T;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

/**
 * ExecutionGraph — the product's core visual. Always visible; never inside a
 * Disclosure. A 3-column SVG (sources → routing → sinks) built imperatively,
 * with confirmed routes drawn in red and an on-mount draw animation, plus a
 * hover-to-trace dim/highlight interaction.
 */
export function ExecutionGraph({ data }: { data: GraphData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || svg.children.length > 0) return; // already built

    // Compute node positions.
    const pos: Record<string, { x: number; y: number; w: number; h: number }> =
      {};
    data.nodes.forEach((n) => {
      pos[n.id] = {
        x: COL_X[n.col],
        y: PAD_TOP + n.row * ROW_GAP,
        w: NODE_W,
        h: NODE_H,
      };
    });

    // Draw edges first (behind nodes).
    const edgeEls: SVGPathElement[] = [];
    data.edges.forEach((edge) => {
      const s = pos[edge.from],
        t = pos[edge.to];
      if (!s || !t) return;
      const x1 = s.x + s.w,
        y1 = s.y + s.h / 2;
      const x2 = t.x,
        y2 = t.y + t.h / 2;
      const mx = (x1 + x2) / 2;
      const path = svgEl<SVGPathElement>("path", {
        d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
        class: `edge${edge.isConfirmedRoute ? " confirmed" : ""}`,
        "data-from": edge.from,
        "data-to": edge.to,
        fill: "none",
        stroke: edge.isConfirmedRoute ? "#ef4444" : "rgba(70,60,50,0.24)",
        "stroke-width": edge.isConfirmedRoute ? "2.3" : "1.3",
      });
      if (edge.isConfirmedRoute) {
        path.style.filter = "drop-shadow(0 1px 4px rgba(239,68,68,0.35))";
      }
      svg.appendChild(path);
      edgeEls.push(path);
    });

    // Draw nodes.
    data.nodes.forEach((n) => {
      const p = pos[n.id];
      const g = svgEl<SVGGElement>("g", {
        class: ["node", n.isSink ? "sink" : "", n.isHot ? "hot" : ""]
          .filter(Boolean)
          .join(" "),
        "data-id": n.id,
      });

      const rect = svgEl<SVGRectElement>("rect", {
        x: String(p.x),
        y: String(p.y),
        width: String(p.w),
        height: String(p.h),
        rx: "10",
        fill: n.isSink ? "rgba(254,232,228,0.88)" : "rgba(255,255,255,0.9)",
        stroke: n.isHot
          ? "#ef4444"
          : n.isSink
            ? "rgba(244,180,172,0.9)"
            : "rgba(255,255,255,0.85)",
        "stroke-width": n.isHot ? "1.6" : "1.1",
      });
      rect.style.filter = "drop-shadow(0 5px 14px rgba(28,25,23,0.10))";
      g.appendChild(rect);

      const typeEl = svgEl<SVGTextElement>("text", {
        x: String(p.x + 15),
        y: String(p.y + 16),
      });
      typeEl.style.cssText =
        "font-family:Geist Mono,monospace;font-size:8.5px;letter-spacing:0.1em;fill:#9a948c;text-transform:uppercase";
      typeEl.textContent = n.type.replace("-", " ").toUpperCase();
      g.appendChild(typeEl);

      const nameEl = svgEl<SVGTextElement>("text", {
        x: String(p.x + 15),
        y: String(p.y + 31),
      });
      nameEl.style.cssText = `font-family:Geist Mono,monospace;font-size:12.5px;font-weight:500;fill:${
        n.isSink ? "#a51d1d" : "#1c1917"
      }`;
      nameEl.textContent = n.name;
      g.appendChild(nameEl);

      // Hover: dim others, highlight connected edges + nodes.
      g.addEventListener("mouseenter", () => {
        svg.classList.add("dim");
        const lit = new Set([n.id]);
        edgeEls.forEach((e) => {
          const from = e.getAttribute("data-from"),
            to = e.getAttribute("data-to");
          if (from === n.id || to === n.id) {
            e.classList.add("on");
            if (from) lit.add(from);
            if (to) lit.add(to);
          } else e.classList.remove("on");
        });
        svg.querySelectorAll<SVGGElement>(".node").forEach((ng) =>
          ng.classList.toggle("lit", lit.has(ng.getAttribute("data-id") ?? "")),
        );
      });
      g.addEventListener("mouseleave", () => {
        svg.classList.remove("dim");
        edgeEls.forEach((e) => e.classList.remove("on"));
        svg.querySelectorAll(".node").forEach((ng) =>
          ng.classList.remove("lit"),
        );
      });

      svg.appendChild(g);
    });

    // Animate confirmed edges on mount (respects prefers-reduced-motion).
    if (!window.matchMedia("(prefers-reduced-motion:reduce)").matches) {
      edgeEls
        .filter((e) => e.classList.contains("confirmed"))
        .forEach((path, i) => {
          const len = path.getTotalLength();
          path.style.strokeDasharray = String(len);
          path.style.strokeDashoffset = String(len);
          path.animate(
            [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
            { duration: 700, delay: i * 240, fill: "forwards", easing: "ease-out" },
          );
        });
    }

    // Clear on unmount so a remount (or data change) rebuilds cleanly.
    return () => {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    };
  }, [data]);

  return (
    <div className="glass overflow-hidden rounded-3xl p-3 pb-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="block h-auto w-full [&.dim_.edge.on]:[stroke-width:2.3] [&.dim_.edge.on]:!stroke-danger-500 [&.dim_.edge:not(.on)]:opacity-20 [&.dim_.node:not(.lit)_rect]:opacity-45"
        aria-label="Execution path map"
        role="img"
      />
      <div className="flex flex-wrap gap-5 px-4 py-2 font-mono text-xs text-ink-muted">
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-danger-500" /> Confirmed route
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-5 bg-[rgba(90,80,68,0.3)]" />{" "}
          Possible route
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-danger-line bg-danger-soft" />{" "}
          Sensitive action — hover any node to trace
        </span>
      </div>
    </div>
  );
}

export default ExecutionGraph;
