"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';

type RiskIncident = {
  id: string;
  project: string;
  score: number;
  rule: string;
  status: string;
  ts: string;
};

type LineageEvent = {
  timestamp: string;
  event: string;
  commit: string;
};

export default function RiskRegistryPage() {
  const [incidents, setIncidents] = useState<RiskIncident[]>([]);
  const [storageConfigured, setStorageConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Vulnerability lineage drilldown + SIEM evidence export
  // (ported from codex/mcp-audit-launch-evidence onto this page's shell).
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [lineageData, setLineageData] = useState<LineageEvent[] | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageError, setLineageError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/risk-registry')
      .then(res => res.json())
      .then(data => {
        setIncidents(Array.isArray(data.incidents) ? data.incidents : []);
        setStorageConfigured(data.storageConfigured !== false);
      })
      .catch(() => {
        setStorageConfigured(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchLineage = async (promptId: string) => {
    setSelectedPrompt(promptId);
    setLineageLoading(true);
    setLineageError(null);
    setLineageData(null);
    try {
      const res = await fetch(`/api/lineage/${promptId}`);
      const data = await res.json();
      setLineageData(Array.isArray(data.history) ? data.history : []);
    } catch {
      setLineageError('Lineage could not be loaded for this prompt.');
    } finally {
      setLineageLoading(false);
    }
  };

  const downloadSiemExport = () => {
    if (!lineageData) return;
    const blob = new Blob(
      [JSON.stringify({ prompt_id: selectedPrompt, evidence_card: lineageData }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-card-${selectedPrompt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Risk List</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Saved high-risk execution-path findings from real scans.
            </p>
            <p className="mt-2 text-sm font-bold text-slate-700">
              PromptSonar does not show fabricated incidents, timestamps, projects, or trend data.
            </p>
          </div>
          <Link href="/playground" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Playground
          </Link>
        </header>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-sm font-semibold text-slate-500">Loading saved risk list...</p>
          ) : incidents.length === 0 ? (
            <div className="max-w-3xl">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Coming Soon
              </span>
              <h2 className="mt-4 text-2xl font-black">No saved risk list available.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {storageConfigured === false
                  ? 'Persistent storage is not configured, so PromptSonar cannot show user scan history here.'
                  : 'No saved high-risk scans were found.'}
              </p>
              <div className="mt-5 grid gap-3 text-sm font-semibold text-slate-700 sm:grid-cols-2">
                {[
                  'Prompt name',
                  'Risk',
                  'Sensitive action reached',
                  'Timestamp',
                  'Open report',
                  'Re-run scan',
                  'Compare changes',
                ].map(item => (
                  <div key={item} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-4 py-3">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="overflow-x-auto lg:col-span-2">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E4E3DE] text-[10px] uppercase tracking-widest text-slate-400">
                      <th className="px-4 py-3 font-black">Prompt Name</th>
                      <th className="px-4 py-3 font-black">Risk</th>
                      <th className="px-4 py-3 font-black">Action Reached</th>
                      <th className="px-4 py-3 font-black">Timestamp</th>
                      <th className="px-4 py-3 font-black">Result</th>
                      <th className="px-4 py-3 text-right font-black">Lineage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E3DE]">
                    {incidents.map(incident => (
                      <tr key={incident.id}>
                        <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">{incident.id}</td>
                        <td className="px-4 py-3 font-black">{incident.score}/100</td>
                        <td className="px-4 py-3 text-slate-600">{incident.rule}</td>
                        <td className="px-4 py-3 text-slate-600">{new Date(incident.ts).toLocaleString()}</td>
                        <td className="px-4 py-3 text-slate-600">{incident.status}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => fetchLineage(incident.id)}
                            className="text-xs font-black uppercase tracking-wider text-slate-700 underline-offset-4 transition hover:underline"
                          >
                            Analyze
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside className="flex flex-col rounded-2xl border border-[#E4E3DE] bg-[#FAF9F6] p-5">
                <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Vulnerability Lineage</h2>
                {!selectedPrompt ? (
                  <p className="mt-4 flex-1 text-sm leading-6 text-slate-600">
                    Select a prompt to trace its recorded lineage and export a SIEM evidence card.
                  </p>
                ) : lineageLoading ? (
                  <p className="mt-4 text-sm font-semibold text-slate-500">Loading lineage...</p>
                ) : lineageError ? (
                  <p className="mt-4 text-sm font-semibold text-slate-600">{lineageError}</p>
                ) : lineageData && lineageData.length > 0 ? (
                  <div className="mt-4 flex flex-1 flex-col">
                    <div className="font-mono text-sm font-bold text-slate-800">{selectedPrompt}</div>
                    <div className="mt-4 flex-1 space-y-4">
                      {lineageData.map((evt, idx) => (
                        <div key={idx} className="border-l border-[#E4E3DE] pl-4">
                          <div className="text-[10px] uppercase tracking-widest text-slate-400">
                            {new Date(evt.timestamp).toLocaleString()}
                          </div>
                          <div className="text-sm font-bold text-slate-800">{evt.event}</div>
                          <div className="mt-1 font-mono text-[11px] text-slate-500">Commit: {evt.commit}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={downloadSiemExport}
                      className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-800 shadow-sm transition hover:bg-slate-50"
                    >
                      Download SIEM Evidence (JSON)
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-600">No recorded lineage for this prompt.</p>
                )}
              </aside>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
