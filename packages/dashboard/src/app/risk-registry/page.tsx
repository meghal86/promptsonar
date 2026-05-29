"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function RiskRegistryPage() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [lineageData, setLineageData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingRegistry, setFetchingRegistry] = useState(true);

  useEffect(() => {
    // Fetch live risk registry on mount
    fetch('/api/risk-registry')
      .then(res => res.json())
      .then(data => {
        if (data.incidents) setIncidents(data.incidents);
        setFetchingRegistry(false);
      })
      .catch(err => {
        console.error("Failed fetching live registry: ", err);
        setFetchingRegistry(false);
      });
  }, []);

  const fetchLineage = async (promptId: string) => {
    setSelectedPrompt(promptId);
    setLoading(true);
    try {
      const res = await fetch(`/api/lineage/${promptId}`);
      const data = await res.json();
      setLineageData(data.history);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const downloadSiemExport = () => {
    if (!lineageData) return;
    const blob = new Blob([JSON.stringify({ evidence_card: lineageData }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence-card-${selectedPrompt}.json`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#07090E] text-slate-200 font-sans">
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-red-900/10 via-[#07090E] to-[#07090E]"></div>
      
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <header className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400 tracking-tight">
              Risk Registry
            </h1>
            <p className="mt-2 text-slate-400 text-lg">Enterprise Incident Forensics & Article 19 Audit Logs</p>
          </div>
          <div className="flex gap-4">
            <Link href="/try" className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-6 py-2.5 rounded-full font-medium transition-all duration-300">
              Try Prompt →
            </Link>
            <Link href="/projects" className="bg-white/5 border border-white/10 hover:bg-white/10 text-white px-6 py-2.5 rounded-full font-medium transition-all duration-300">
              ← Back to Projects
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Registry Table */}
          <div className="lg:col-span-2 bg-[#0F131D]/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5">
              <h2 className="text-xl font-bold">Critical Vulnerabilities</h2>
            </div>
            <div className="overflow-x-auto">
              {fetchingRegistry ? (
                <div className="p-8 text-center text-slate-500 animate-pulse">Syncing with database...</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/5 text-xs uppercase text-slate-400 tracking-widest">
                      <th className="px-6 py-4 font-semibold">Prompt Hash</th>
                      <th className="px-6 py-4 font-semibold">Project</th>
                      <th className="px-6 py-4 font-semibold">Violation</th>
                      <th className="px-6 py-4 font-semibold">Score</th>
                      <th className="px-6 py-4 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm">
                    {incidents.map((incident) => (
                      <tr key={incident.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-mono text-xs text-indigo-400">{incident.id}</td>
                        <td className="px-6 py-4">{incident.project}</td>
                        <td className="px-6 py-4 text-rose-400 font-medium">{incident.rule}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${incident.score < 50 ? 'bg-rose-500/20 text-rose-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                            {incident.score}/100
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button 
                            onClick={() => fetchLineage(incident.id)}
                            className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium text-xs uppercase tracking-wider"
                          >
                            Analyze Lineage →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Forensics Drilldown Pane */}
          <div className="bg-[#0F131D]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 flex flex-col">
            <h2 className="text-xl font-bold mb-6">Forensic Intel</h2>
            
            {!selectedPrompt ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm text-center border border-dashed border-white/10 rounded-xl p-8">
                Select a prompt hash to trace its vulnerability lineage and export SIEM evidence.
              </div>
            ) : loading ? (
              <div className="flex-1 flex items-center justify-center text-indigo-400">
                <span className="animate-pulse">Decrypting lineage...</span>
              </div>
            ) : lineageData ? (
              <div className="flex-1 flex flex-col">
                <div className="mb-6">
                  <div className="text-xs text-slate-500 uppercase tracking-widest mb-1">Target Prompt</div>
                  <div className="font-mono text-lg text-rose-400">{selectedPrompt}</div>
                </div>
                
                <div className="space-y-4 flex-1">
                  {lineageData.map((evt, idx) => (
                    <div key={idx} className="relative pl-6 pb-4 border-l border-white/10 last:border-transparent last:pb-0">
                      <div className="absolute w-2 h-2 rounded-full bg-indigo-500 -left-[4.5px] top-1.5 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
                      <div className="text-xs text-slate-400 mb-1">{new Date(evt.timestamp).toLocaleString()}</div>
                      <div className={`text-sm font-medium ${evt.event === 'Vulnerability Introduced' ? 'text-rose-400' : 'text-slate-200'}`}>
                        {evt.event}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 font-mono">Commit: {evt.commit}</div>
                    </div>
                  ))}
                </div>

                <button 
                  onClick={downloadSiemExport}
                  className="w-full mt-8 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <span>Download SIEM Evidence</span>
                  <span className="font-mono text-[10px] opacity-70">JSON</span>
                </button>
              </div>
            ) : null}
          </div>

        </div>
      </main>
    </div>
  );
}
