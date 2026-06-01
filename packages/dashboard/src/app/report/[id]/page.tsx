import type { Metadata } from 'next';
import Link from 'next/link';
import { WorkflowGraph } from '@/components/WorkflowGraph';
import {
  decodeReportPayload,
  verifyExecutionPathReport,
  type ExecutionPathReport,
} from '@/lib/reports/executionPathReport';
import { ReportActions } from './ReportActions';

type ReportPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ payload?: string }>;
};

function getReport(payload?: string): ExecutionPathReport | null {
  if (!payload) return null;
  try {
    return decodeReportPayload(payload);
  } catch {
    try {
      return JSON.parse(payload) as ExecutionPathReport;
    } catch {
      return null;
    }
  }
}

export async function generateMetadata({ params, searchParams }: ReportPageProps): Promise<Metadata> {
  const { id } = await params;
  const query = await searchParams;
  const report = getReport(query?.payload);
  const title = report
    ? `PromptSonar Report ${report.workflow?.risk || 'none'}`
    : 'PromptSonar Execution Path Report';
  const description = report
    ? `Execution path: ${report.workflow?.summary || 'none'}; confidence ${report.confidence.score}% ${report.confidence.level}.`
    : `Read-only PromptSonar execution-path report ${id}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'PromptSonar',
      images: [{ url: `/report/${id}/opengraph-image${query?.payload ? `?payload=${encodeURIComponent(query.payload)}` : ''}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`/report/${id}/opengraph-image${query?.payload ? `?payload=${encodeURIComponent(query.payload)}` : ''}`],
    },
  };
}

export default async function PublicReportPage({ params, searchParams }: ReportPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const report = getReport(query?.payload);
  const reportUrl = `/report/${id}${query?.payload ? `?payload=${encodeURIComponent(query.payload)}` : ''}`;
  const verified = report ? verifyExecutionPathReport(report) && report.report_id === id : false;

  if (!report) {
    return (
      <main className="min-h-screen bg-[#F6F1E8] px-5 py-10 text-slate-950">
        <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">PromptSonar Report</p>
          <h1 className="mt-3 text-3xl font-black">Report payload missing</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            This public report route is read-only and does not rescan prompts. Open a report URL with a sanitized payload.
          </p>
          <Link href="/playground" className="mt-6 inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white">
            Open Playground
          </Link>
        </section>
      </main>
    );
  }

  const critical = report.findings_summary.by_severity.critical;
  const high = report.findings_summary.by_severity.high;
  const riskTone = report.workflow?.risk === 'critical' || critical > 0
    ? 'border-red-200 bg-red-50 text-red-800'
    : report.workflow?.risk === 'high' || high > 0
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';

  return (
    <main className="min-h-screen bg-[#F6F1E8] px-5 py-8 text-slate-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">PromptSonar Public Report</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Execution Path Analysis</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                Read-only sanitized report. Raw prompts, credentials, and matched sensitive text are not stored in this payload.
              </p>
            </div>
            <div className={`rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-widest ${riskTone}`}>
              {report.workflow?.risk || 'No workflow risk'}
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confidence</p>
              <p className="mt-2 text-2xl font-black">{report.confidence.score}%</p>
              <p className="text-xs font-bold text-slate-500">{report.confidence.level}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Findings</p>
              <p className="mt-2 text-2xl font-black">{report.findings_summary.total}</p>
              <p className="text-xs font-bold text-slate-500">{critical} critical, {high} high</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">MCP Risk</p>
              <p className="mt-2 text-2xl font-black">{report.mcp_risk_score?.score ?? 0}</p>
              <p className="text-xs font-bold text-slate-500">{report.mcp_risk_score?.level || 'none'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Integrity</p>
              <p className={`mt-2 text-sm font-black ${verified ? 'text-emerald-700' : 'text-red-700'}`}>{verified ? 'Verified' : 'Hash mismatch'}</p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{report.report_hash}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Execution Path</p>
              <p className="mt-1 font-mono text-sm font-bold text-slate-700">{report.workflow?.summary || 'No execution path inferred.'}</p>
            </div>
          </div>
          <WorkflowGraph workflow={report.workflow ? { path: { nodes: report.workflow.nodes, edges: report.workflow.edges, summary: report.workflow.summary, trustBoundaryCrossed: report.workflow.trust_boundary_crossed, privilegedSinkReached: report.workflow.privileged_sink_reached }, risk: report.workflow.risk } : null} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Evidence</p>
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              {(report.evidence.length ? report.evidence : ['No workflow evidence emitted.']).map((item) => (
                <li key={item} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 font-medium">{item}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Root Cause</p>
            {report.root_cause ? (
              <div className="mt-4">
                <p className="font-mono text-sm font-black text-slate-950">{report.root_cause.rule_id}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{report.root_cause.explanation}</p>
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-slate-400">
                  {report.root_cause.supporting_count} supporting finding(s)
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">No security root cause emitted.</p>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Workflow Diff</p>
          {report.workflow_diff ? (
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Reason</p>
                <p className="mt-2 text-sm font-black">{report.workflow_diff.diff_reason}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Risk reduction</p>
                <p className="mt-2 text-sm font-black">{report.workflow_diff.risk_reduction}%</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Before/after</p>
                <p className="mt-2 text-sm font-black">{report.workflow_diff.before_risk} → {report.workflow_diff.after_risk}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase text-slate-400">Path removed</p>
                <p className="mt-2 text-sm font-black">{report.workflow_diff.execution_path_removed ? 'yes' : 'no'}</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No workflow diff emitted.</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.24em] text-slate-400">Share and Export</p>
          <ReportActions report={report} reportUrl={reportUrl} />
        </section>
      </section>
    </main>
  );
}
