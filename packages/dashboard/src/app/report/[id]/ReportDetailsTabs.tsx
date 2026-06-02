"use client";

import { useState } from "react";
import { WorkflowReplayTimeline } from "@/components/WorkflowReplayTimeline";
import type { ExecutionPathReport } from "@/lib/reports/executionPathReport";
import { ReportActions } from "./ReportActions";

type TabKey = "findings" | "compare" | "history" | "models" | "rules" | "report";

interface EvidenceItem {
  id: string;
  finding_rule_id: string;
  label: string;
}

interface ReportDetailsTabsProps {
  report: ExecutionPathReport;
  reportUrl: string;
  verified: boolean;
  evidenceItems: EvidenceItem[];
  confidenceReasons: string[];
  recommendedFixes: Array<{ finding_rule_id: string; fix: string }>;
  beforePath: string[];
  afterPath: string[];
}

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "findings", label: "Findings" },
  { key: "compare", label: "Compare Scans" },
  { key: "history", label: "Scan History" },
  { key: "models", label: "Models" },
  { key: "rules", label: "Rules" },
  { key: "report", label: "Full Report" },
];

export function ReportDetailsTabs({
  report,
  reportUrl,
  verified,
  evidenceItems,
  confidenceReasons,
  recommendedFixes,
  beforePath,
  afterPath,
}: ReportDetailsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("findings");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Details</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition ${
                activeTab === tab.key
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "findings" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Evidence</p>
            {evidenceItems.length ? evidenceItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                <p className="text-sm font-bold text-slate-800">{item.label}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer font-mono text-[10px] font-bold text-slate-500">Technical ID</summary>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">{item.finding_rule_id}</p>
                </details>
              </div>
            )) : (
              <p className="text-sm text-slate-600">No evidence available for this scan.</p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confidence reasons</p>
            <p className="text-[11px] font-medium text-slate-500">Confidence: higher means the scanner found stronger evidence.</p>
            {(confidenceReasons.length ? confidenceReasons : ["No confidence details available."]).slice(0, 5).map((reason) => (
              <div key={reason} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                {reason}
              </div>
            ))}
            {report.root_cause?.supporting_findings?.length ? (
              <details className="rounded-lg border border-slate-100 bg-white p-3">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Supporting findings
                </summary>
                <div className="mt-3 space-y-2">
                  {report.root_cause.supporting_findings.map((finding) => (
                    <div key={finding.rule_id} className="rounded-lg bg-slate-50 px-3 py-2">
                      <p className="font-mono text-xs font-black">{finding.rule_id}</p>
                      <p className="mt-1 text-xs text-slate-600">{finding.explanation}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      )}

      {activeTab === "compare" && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Before / after route</p>
            {report.workflow_diff ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800">
                {report.workflow_diff.risk_reduction}% risk reduction - path removed: {report.workflow_diff.execution_path_removed ? "YES" : "NO"}
                <p className="mt-1 text-xs font-semibold normal-case tracking-normal">estimated reduction after applying the safer pattern</p>
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Before</p>
              <div className="mt-3 space-y-2">
                {beforePath.map((node, index) => <div key={`${node}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-800">{node}</div>)}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">After</p>
              <div className="mt-3 space-y-2">
                {afterPath.map((node, index) => <div key={`${node}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-800">{node}</div>)}
              </div>
            </div>
          </div>
          {recommendedFixes.length ? (
            <details className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-400">All recommended fixes</summary>
              <div className="mt-3 space-y-2">
                {recommendedFixes.map((fix, index) => (
                  <div key={`${fix.finding_rule_id}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                    <p className="text-sm font-bold text-slate-800">{index + 1}. {fix.fix}</p>
                    <p className="mt-1 font-mono text-[11px] font-bold text-slate-500">Mapped finding: {fix.finding_rule_id}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}

      {activeTab === "history" && (
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Generated</p>
            <p className="mt-2 font-mono text-[11px] font-black">{new Date(report.generated_at).toISOString()}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Report verification</p>
            <p className={`mt-2 text-sm font-black ${verified ? "text-emerald-700" : "text-red-700"}`}>{verified ? "verified" : "hash mismatch"}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-400">Report ID</summary>
              <p className="mt-1 break-all font-mono text-[11px] font-black">{report.report_id}</p>
            </details>
          </div>
          <div className="md:col-span-3">
            <WorkflowReplayTimeline replay={report.workflow_replay} />
          </div>
        </div>
      )}

      {activeTab === "models" && (
        <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm font-semibold text-slate-600">
          No model comparison is attached to this report.
        </div>
      )}

      {activeTab === "rules" && (
        <div className="mt-5 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mapped finding IDs</p>
          {recommendedFixes.length ? recommendedFixes.map((fix) => (
            <div key={fix.finding_rule_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs font-black">
              {fix.finding_rule_id}
            </div>
          )) : (
            <p className="text-sm text-slate-600">No rules were attached to this report.</p>
          )}
        </div>
      )}

      {activeTab === "report" && (
        <div className="mt-5 space-y-4">
          <ReportActions report={report} reportUrl={reportUrl} />
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            Verification: <span className={verified ? "font-black text-emerald-700" : "font-black text-red-700"}>{verified ? "verified" : "hash mismatch"}</span>
          </div>
        </div>
      )}
    </section>
  );
}
