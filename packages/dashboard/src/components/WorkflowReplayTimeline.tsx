"use client";

interface ReplayEventEvidence {
  rule_id?: string;
  ruleId?: string;
  label?: string;
  source?: string;
  severity?: string;
}

interface ReplayEvent {
  index: number;
  timestamp: string;
  type: string;
  label?: string;
  trust?: string;
  confidence?: string;
  confidence_contribution?: number;
  confidenceContribution?: number;
  trust_boundary_crossed?: boolean;
  trustBoundaryCrossed?: boolean;
  risk_before?: string;
  riskBefore?: string;
  risk_after?: string;
  riskAfter?: string;
  risk_transition?: string;
  riskTransition?: string;
  reason?: string;
  matched_rules?: string[];
  matchedRules?: string[];
  provenance?: ReplayEventEvidence[];
}

interface WorkflowReplay {
  replay_version?: string;
  replayVersion?: string;
  timeline?: string[];
  risk_evolution?: string[];
  riskEvolution?: string[];
  events?: ReplayEvent[];
}

interface WorkflowReplayTimelineProps {
  replay?: WorkflowReplay | null;
  compact?: boolean;
}

function riskTone(risk?: string): string {
  if (risk === "DANGEROUS") return "border-red-200 bg-red-50 text-red-800";
  if (risk === "REVIEW") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatRuleList(event: ReplayEvent): string {
  const rules = event.matched_rules || event.matchedRules || [];
  return rules.length ? rules.join(", ") : "workflow graph";
}

export function WorkflowReplayTimeline({ replay, compact = false }: WorkflowReplayTimelineProps) {
  const events = replay?.events || [];

  if (!events.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        No replay available for this scan.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Workflow Replay</p>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] font-bold uppercase text-slate-500">
          replay v{replay?.replay_version || replay?.replayVersion || "1.0"}
        </span>
      </div>
      <p className="-mt-1 text-[11px] font-medium text-slate-500">
        Replay shows the scan steps that can be rerun or reviewed.
      </p>
      <div className="space-y-2">
        {events.map((event) => {
          const riskAfter = event.risk_after || event.riskAfter || "SAFE";
          const transition = event.risk_transition || event.riskTransition || `${event.risk_before || event.riskBefore || "SAFE"}->${riskAfter}`;
          const confidenceContribution = event.confidence_contribution ?? event.confidenceContribution ?? 0;
          const trustBoundaryCrossed = event.trust_boundary_crossed ?? event.trustBoundaryCrossed ?? false;
          const evidence = event.provenance || [];

          return (
            <div key={`${event.index}-${event.type}`} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 font-mono text-[10px] font-black text-white">
                      {String(event.index).padStart(2, "0")}
                    </span>
                    <span className="font-mono text-xs font-black uppercase text-slate-900">{event.type}</span>
                    <span className="font-mono text-[10px] font-bold text-slate-400">{event.timestamp}</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-800">{event.label || event.type}</p>
                  {!compact && event.reason ? (
                    <p className="mt-1 text-xs leading-5 text-slate-600">{event.reason}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${riskTone(riskAfter)}`}>
                    {transition}
                  </span>
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {event.confidence || "medium"} / +{confidenceContribution}
                  </span>
                  {trustBoundaryCrossed ? (
                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-800">
                      boundary
                    </span>
                  ) : null}
                </div>
              </div>
              {!compact ? (
                <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 md:grid-cols-[0.8fr_1.2fr]">
                  <div>
                    <span className="font-black uppercase tracking-wider text-slate-400">Matched rules</span>
                    <p className="mt-1 font-mono text-[11px] text-slate-700">{formatRuleList(event)}</p>
                  </div>
                  <div>
                    <span className="font-black uppercase tracking-wider text-slate-400">Evidence</span>
                    <p className="text-[10px] font-medium text-slate-500">Supporting details from this scan step.</p>
                    <p className="mt-1 text-[11px] text-slate-700">
                      {evidence[0]?.label || "workflow graph"}
                      {evidence[0]?.source ? `: ${evidence[0].source}` : ""}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
