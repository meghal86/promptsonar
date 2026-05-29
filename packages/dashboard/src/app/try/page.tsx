"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// /try — a minimal, mobile-first, two-screen prompt scanner.
//
// Screen 1: a single full-width prompt textarea + one Scan button.
// Screen 2: the single worst finding rendered as a short vertical node graph.
//
// It reuses POST /api/playground exactly as the playground does. No engine,
// scoring, SARIF, CLI, or API code is touched here. This page only reads the
// existing scan response and shows a stripped-down view of it.
// ---------------------------------------------------------------------------

type Severity = "low" | "medium" | "high" | "critical";

interface WorkflowNode {
  id: string;
  label: string;
  type: string;
  trust?: string;
}

interface WorkflowPath {
  nodes: WorkflowNode[];
  privilegedSinkReached?: boolean;
  trustBoundaryCrossed?: boolean;
}

interface FindingWorkflow {
  path?: WorkflowPath;
  sink?: string;
}

interface Finding {
  rule_id: string;
  severity: Severity;
  explanation?: string;
  suggested_fix?: string;
  workflow?: FindingWorkflow;
}

// Human-readable names for workflow node types (node.label is just the type id).
const NODE_LABELS: Record<string, string> = {
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

const labelFor = (node: WorkflowNode): string =>
  NODE_LABELS[node.type] || node.label?.replace(/_/g, " ") || "Step";

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Score a finding so we can surface exactly one — the worst. Workflow paths
// that reach a privileged sink dominate; otherwise we fall back to severity.
function findingScore(f: Finding): number {
  let s = 0;
  if (f.workflow?.path?.privilegedSinkReached) s += 1000;
  if (f.workflow?.path?.nodes?.length) s += 200;
  if (f.workflow?.path?.trustBoundaryCrossed) s += 100;
  s += (SEVERITY_RANK[f.severity] || 0) * 10;
  return s;
}

function pickWorst(findings: Finding[]): Finding | null {
  if (!findings || findings.length === 0) return null;
  return [...findings].sort((a, b) => findingScore(b) - findingScore(a))[0];
}

type ScreenState = "input" | "result";

export default function TryPage() {
  const [prompt, setPrompt] = useState("");
  const [screen, setScreen] = useState<ScreenState>("input");
  const [loading, setLoading] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worst, setWorst] = useState<Finding | null>(null);
  const [hadFindings, setHadFindings] = useState(false);

  // Pre-fill from ?prompt=... so a link can ship a ready-to-scan example.
  // Read on the client only so hard refresh always works.
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("prompt");
      if (fromUrl) setPrompt(fromUrl);
    } catch {
      // ignore malformed query strings
    }
  }, []);

  async function handleScan() {
    setError(null);
    if (!prompt.trim()) {
      setValidation("Paste a prompt to scan.");
      return;
    }
    setValidation(null);
    setLoading(true);
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Scan failed (HTTP ${res.status})`);
      }
      const findings: Finding[] = Array.isArray(data.findings) ? data.findings : [];
      setHadFindings(findings.length > 0);
      setWorst(pickWorst(findings));
      setScreen("result");
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? "Couldn't scan that prompt. Please try again."
          : "Couldn't scan that prompt. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setScreen("input");
    setWorst(null);
    setError(null);
    setValidation(null);
  }

  // -------------------------------------------------------------------------
  // SCREEN 2 — result
  // -------------------------------------------------------------------------
  if (screen === "result") {
    const path = worst?.workflow?.path;
    const sinkType = worst?.workflow?.sink;
    const critical = !!path?.privilegedSinkReached;

    // Critical path nodes only, capped at 6 (keep the source and the sink).
    let nodes: WorkflowNode[] = path?.nodes ?? [];
    if (nodes.length > 6) {
      nodes = [...nodes.slice(0, 5), nodes[nodes.length - 1]];
    }

    const verdict = worst
      ? critical
        ? "This prompt can reach a privileged action"
        : "This prompt has a risky path"
      : "No critical execution path found";

    const accent = worst
      ? critical
        ? "text-red-600"
        : "text-amber-600"
      : "text-emerald-600";

    const dot = worst
      ? critical
        ? "bg-red-500"
        : "bg-amber-500"
      : "bg-emerald-500";

    return (
      <main className="min-h-screen w-full bg-[#FAF9F6] text-[#1C1917] antialiased flex flex-col items-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md flex flex-col gap-7">
          {/* Verdict */}
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#A8A29E]">
                Scan result
              </span>
            </span>
            <h1 className={`text-2xl font-black leading-tight tracking-tight ${accent}`}>
              {verdict}
            </h1>
            {worst?.explanation && (
              <p className="text-[15px] leading-relaxed text-[#57534E]">
                {worst.explanation}
              </p>
            )}
          </div>

          {/* Node graph — vertical, max 6 nodes */}
          {worst && nodes.length > 0 ? (
            <div className="flex flex-col items-stretch gap-0">
              {nodes.map((node, i) => {
                const isSink = critical && sinkType ? node.type === sinkType : false;
                const isLast = i === nodes.length - 1;
                const redSink = isSink || (critical && isLast);
                return (
                  <React.Fragment key={`${node.id}-${i}`}>
                    <div
                      className={`relative rounded-xl border-2 bg-white px-4 py-3 text-center text-[15px] font-semibold shadow-sm ${
                        redSink
                          ? "border-red-500 text-red-700"
                          : "border-[#D6D3D1] text-[#1C1917]"
                      }`}
                    >
                      {labelFor(node)}
                      {redSink && (
                        <span
                          aria-hidden="true"
                          className="absolute right-3 top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-red-500 md:motion-safe:block md:motion-safe:animate-pulse"
                        />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className="select-none py-1 text-center text-xl leading-none text-[#A8A29E]"
                        aria-hidden="true"
                      >
                        ↓
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border-2 border-[#D6D3D1] bg-white px-4 py-6 text-center text-[15px] text-[#57534E]">
              {worst
                ? "No execution path to map for this prompt."
                : hadFindings
                ? "Only minor observations found — nothing reaches a privileged action."
                : "Looks clean. No risky path detected."}
            </div>
          )}

          {/* One-line fix, if available */}
          {worst?.suggested_fix && (
            <div className="rounded-xl border border-[#E4E3DE] bg-white px-4 py-3">
              <span className="block text-xs font-bold uppercase tracking-wider text-[#A8A29E]">
                Suggested fix
              </span>
              <p className="mt-1 text-[14px] leading-relaxed text-[#1C1917]">
                {worst.suggested_fix}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <button
              onClick={handleReset}
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-5 text-[15px] font-bold text-white shadow-sm transition-colors hover:bg-slate-800"
            >
              Scan another prompt
            </button>
            <Link
              href="/playground"
              className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#E4E3DE] bg-white px-5 text-[15px] font-semibold text-[#1C1917] transition-colors hover:bg-slate-50"
            >
              View full analysis →
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // -------------------------------------------------------------------------
  // SCREEN 1 — input
  // -------------------------------------------------------------------------
  return (
    <main className="min-h-screen w-full bg-[#FAF9F6] text-[#1C1917] antialiased flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-3xl font-black tracking-tight">PromptSonar</h1>
          <p className="text-[15px] leading-relaxed text-[#57534E]">
            Paste a prompt to see how it could reach tools, memory, and execution.
          </p>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (validation) setValidation(null);
          }}
          rows={8}
          aria-label="Prompt to scan"
          placeholder="Paste your prompt here…"
          className="w-full min-h-[200px] resize-y rounded-xl border border-[#E4E3DE] bg-white p-4 font-mono text-[14px] leading-7 text-[#1C1917] shadow-sm outline-none placeholder-[#A8A29E] transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />

        {validation && (
          <p className="text-[14px] font-medium text-amber-700" role="alert">
            {validation}
          </p>
        )}

        {error && (
          <p className="text-[14px] font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          onClick={handleScan}
          disabled={loading}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-slate-900 px-5 text-[16px] font-bold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Scanning…" : "Scan prompt"}
        </button>
      </div>
    </main>
  );
}
