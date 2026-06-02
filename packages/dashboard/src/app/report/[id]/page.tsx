import type { Metadata } from 'next';
import Link from 'next/link';
import { WorkflowGraph } from '@/components/WorkflowGraph';
import { WorkflowReplayTimeline } from '@/components/WorkflowReplayTimeline';
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

function humanize(value?: string | null): string {
  if (!value) return 'None';
  return value
    .replace(/_/g, ' ')
    .replace(/\bmcp\b/gi, 'MCP')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\brag\b/gi, 'RAG')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function riskTone(verdict?: string): string {
  const value = (verdict || '').toLowerCase();
  if (value === 'critical') return 'border-red-200 bg-red-50 text-red-800';
  if (value === 'high') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (value === 'medium') return 'border-yellow-200 bg-yellow-50 text-yellow-800';
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function pathLines(path?: string[] | null): string[] {
  return path?.length ? path.map(humanize) : ['No execution path inferred'];
}

export async function generateMetadata({ params, searchParams }: ReportPageProps): Promise<Metadata> {
  const { id } = await params;
  const query = await searchParams;
  const report = getReport(query?.payload);
  const title = report
    ? `PromptSonar Execution Path Review ${report.verdict || report.workflow?.risk || 'ready'}`
    : 'PromptSonar Execution Path Review';
  const description = report
    ? `Execution path: ${report.workflow?.summary || 'none'}; confidence ${report.confidence.score}% ${report.confidence.level}.`
    : `Read-only PromptSonar execution-path review ${id}.`;

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

  const verdict = report.verdict || report.workflow?.risk?.toUpperCase() || 'READY';
  const executionRisk = report.execution_risk ?? report.workflow_diff?.before_risk ?? 0;
  const confidenceReasons = report.confidence.reasons || [];
  const recommendedFixes = report.recommended_fixes || [];
  const path = pathLines(report.workflow?.path);
  const beforePath = pathLines(report.workflow_diff?.before_path);
  const afterPath = pathLines(report.workflow_diff?.after_path);
  const evidenceItems = report.evidence_items?.length
    ? report.evidence_items
    : report.evidence.map((item, index) => ({
      id: `legacy-${index}`,
      finding_rule_id: 'workflow_evidence',
      label: item,
    }));

  return (
    <main className="min-h-screen bg-[#F6F1E8] px-5 py-8 text-slate-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Execution Path Review</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Read-only sanitized public report. Raw prompts, secrets, and matched sensitive text are redacted before sharing.
              </p>
            </div>
            <div className={`rounded-xl border px-5 py-4 text-sm font-black uppercase tracking-widest ${riskTone(verdict)}`}>
              Verdict: {verdict}
            </div>
          </div>

          <div className="mt-7 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Execution Risk</p>
              <p className="mt-2 text-2xl font-black">{executionRisk} / 100</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Confidence</p>
              <p className="mt-2 text-2xl font-black">{report.confidence.score}%</p>
              <p className="text-xs font-bold text-slate-500">{report.confidence.level}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Root Cause</p>
              <p className="mt-2 text-sm font-black">{humanize(report.root_cause?.rule_id)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Privileged Sink</p>
              <p className="mt-2 text-sm font-black">{report.privileged_sink || 'None'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Generated</p>
              <p className="mt-2 font-mono text-[11px] font-black">{new Date(report.generated_at).toISOString()}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Report ID</p>
              <p className="mt-2 break-all font-mono text-[11px] font-black">{report.report_id}</p>
              <p className={`mt-1 text-[10px] font-bold ${verified ? 'text-emerald-700' : 'text-red-700'}`}>{verified ? 'verified' : 'hash mismatch'}</p>
            </div>
          </div>

          <div className="mt-7 rounded-xl border border-slate-200 bg-slate-950 p-5 text-white">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Execution Path</p>
            <div className="mt-4 grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
              {path.map((node, index) => (
                <div key={`${node}-${index}`} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Step {index + 1}</p>
                  <p className="mt-1 text-sm font-black uppercase">{node}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Execution Path Hero</p>
            <p className="mt-1 font-mono text-sm font-bold text-slate-700">{report.workflow?.summary || 'No execution path inferred.'}</p>
          </div>
          <WorkflowGraph compact maxVisibleNodes={5} workflow={report.workflow ? { path: { nodes: report.workflow.nodes, edges: report.workflow.edges, summary: report.workflow.summary, trustBoundaryCrossed: report.workflow.trust_boundary_crossed, privilegedSinkReached: report.workflow.privileged_sink_reached }, risk: report.workflow.risk } : null} />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Evidence</p>
            <div className="mt-4 space-y-2">
              {evidenceItems.length ? evidenceItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-800">{item.label}</p>
                  <p className="mt-1 font-mono text-[11px] font-bold text-slate-500">Finding: {item.finding_rule_id}</p>
                </div>
              )) : (
                <p className="text-sm text-slate-600">No workflow evidence emitted.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Execution Path Confidence</p>
            <p className="mt-4 text-5xl font-black">{report.confidence.score}%</p>
            <p className="mt-1 text-sm font-black uppercase tracking-widest text-slate-500">{report.confidence.level} confidence</p>
            <div className="mt-5 space-y-2">
              {(confidenceReasons.length ? confidenceReasons : ['No confidence evidence emitted.']).map((reason) => (
                <div key={reason} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                  {reason}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Root Cause</p>
            {report.root_cause ? (
              <div className="mt-4">
                <p className="text-2xl font-black">{humanize(report.root_cause.rule_id)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{report.root_cause.explanation || 'No explanation emitted.'}</p>
                <p className="mt-5 text-[10px] font-black uppercase tracking-widest text-slate-400">Supporting Findings</p>
                <div className="mt-2 space-y-2">
                  {report.root_cause.supporting_findings?.length ? report.root_cause.supporting_findings.map((finding) => (
                    <div key={finding.rule_id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="font-mono text-xs font-black">{finding.rule_id}</p>
                      <p className="mt-1 text-xs text-slate-600">{finding.explanation}</p>
                    </div>
                  )) : (
                    <p className="text-sm text-slate-600">No supporting findings emitted.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">No security root cause emitted.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <WorkflowReplayTimeline replay={report.workflow_replay} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Workflow Diff</p>
              <p className="mt-1 text-sm font-bold text-slate-600">What changed after remediation.</p>
            </div>
            {report.workflow_diff ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-800">
                {report.workflow_diff.risk_reduction}% risk reduction - path removed: {report.workflow_diff.execution_path_removed ? 'YES' : 'NO'}
              </div>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Before</p>
              <div className="mt-3 space-y-2">
                {beforePath.map((node, index) => (
                  <div key={`${node}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-800">{node}</div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">After</p>
              <div className="mt-3 space-y-2">
                {afterPath.map((node, index) => (
                  <div key={`${node}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-800">{node}</div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Recommended Fixes</p>
            <div className="mt-4 space-y-2">
              {recommendedFixes.length ? recommendedFixes.map((fix, index) => (
                <div key={`${fix.finding_rule_id}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-bold text-slate-800">{index + 1}. {fix.fix}</p>
                  <p className="mt-1 font-mono text-[11px] font-bold text-slate-500">Mapped finding: {fix.finding_rule_id}</p>
                </div>
              )) : (
                <p className="text-sm text-slate-600">No deterministic recommended fixes emitted.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="mb-4 text-xs font-black uppercase tracking-[0.24em] text-slate-400">Exports</p>
            <ReportActions report={report} reportUrl={reportUrl} />
          </div>
        </section>
      </section>
    </main>
  );
}
