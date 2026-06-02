"use client";

import {
  encodeReportPayload,
  type ExecutionPathReport,
  reportToIssueTemplate,
  reportToJson,
  reportToMarkdown,
  reportToPrComment,
  reportToSarif,
} from '@/lib/reports/executionPathReport';

interface ReportActionsProps {
  report: ExecutionPathReport;
  reportUrl: string;
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function ReportActions({ report, reportUrl }: ReportActionsProps) {
  const pngUrl = `/report/${report.report_id}/opengraph-image?payload=${encodeURIComponent(encodeReportPayload(report))}`;
  const absoluteReportUrl = () => new URL(reportUrl, window.location.origin).toString();

  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <button
        onClick={() => copyText(absoluteReportUrl())}
        className="rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-slate-800"
      >
        Copy Report URL
      </button>
      <button
        onClick={() => copyText(reportToMarkdown(report, absoluteReportUrl()))}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Copy Markdown
      </button>
      <button
        onClick={() => copyText(reportToIssueTemplate(report, absoluteReportUrl()))}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Copy GitHub Issue
      </button>
      <button
        onClick={() => copyText(reportToPrComment(report, absoluteReportUrl()))}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Copy GitHub Comment
      </button>
      <button
        onClick={() => downloadText(`promptsonar-report-${report.report_id}.json`, reportToJson(report), 'application/json')}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Export JSON
      </button>
      <button
        onClick={() => downloadText(`promptsonar-report-${report.report_id}.sarif`, reportToSarif(report), 'application/sarif+json')}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Export SARIF
      </button>
      <button
        onClick={() => downloadText(`promptsonar-report-${report.report_id}.md`, reportToMarkdown(report, reportUrl), 'text/markdown')}
        className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
      >
        Export Markdown
      </button>
      <a
        href={pngUrl}
        download={`promptsonar-report-${report.report_id}.png`}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-xs font-black uppercase tracking-widest text-emerald-700 transition hover:bg-emerald-100"
      >
        Export PNG
      </a>
    </div>
  );
}
