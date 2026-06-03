"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';

type OutputRow = {
  modelName: string;
  output: string;
};

type ComparisonResult = {
  id: string;
  createdAt: string;
  outputCount: number;
  baselineModelId?: string;
  models: Array<{
    modelId: string;
    modelName: string;
    outputHash: string;
    safetyScore: number;
    behaviorVariance: number;
    formatPassed: boolean;
    findingsCount: number;
    criticalCount: number;
    highCount: number;
    status: 'stable' | 'needs_review' | 'high_risk';
    findings: Array<{ rule_id: string; severity: string; explanation: string; suggested_fix?: string }>;
  }>;
  summary: {
    bestModelId?: string;
    riskiestModelId?: string;
    averageSafetyScore: number;
    maxBehaviorVariance: number;
    needsReviewCount: number;
  };
};

const initialRows: OutputRow[] = [
  { modelName: '', output: '' },
  { modelName: '', output: '' },
];

function slugModelId(name: string, index: number): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `model-${index + 1}`;
}

function statusLabel(status: string): string {
  if (status === 'high_risk') return 'High Risk';
  if (status === 'needs_review') return 'Needs Review';
  return 'Stable';
}

function statusClass(status: string): string {
  if (status === 'high_risk') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'needs_review') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

export default function ModelsPage() {
  const [showForm, setShowForm] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [expectedFormat, setExpectedFormat] = useState('');
  const [outputs, setOutputs] = useState<OutputRow[]>(initialRows);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [submittedOutputs, setSubmittedOutputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resultJson = useMemo(() => result ? JSON.stringify(result, null, 2) : '', [result]);
  const bestModel = result?.models.find(model => model.modelId === result.summary.bestModelId);
  const riskiestModel = result?.models.find(model => model.modelId === result.summary.riskiestModelId);

  const updateOutput = (index: number, patch: Partial<OutputRow>) => {
    setOutputs(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const addOutput = () => {
    setOutputs(current => [...current, { modelName: '', output: '' }]);
  };

  const removeOutput = (index: number) => {
    setOutputs(current => current.length <= 2 ? current : current.filter((_, rowIndex) => rowIndex !== index));
  };

  const runComparison = async () => {
    setError(null);
    if (!prompt.trim()) {
      setError('Original prompt is required.');
      return;
    }
    const completedOutputs = outputs
      .map((row, index) => ({
        modelId: slugModelId(row.modelName, index),
        modelName: row.modelName.trim(),
        output: row.output.trim(),
      }))
      .filter(row => row.modelName || row.output);

    if (completedOutputs.length < 2) {
      setError('Add at least 2 model outputs.');
      return;
    }
    const incomplete = completedOutputs.find(row => !row.modelName || !row.output);
    if (incomplete) {
      setError('Each model output needs a model name and output text.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/model-comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          expectedFormat: expectedFormat || undefined,
          outputs: completedOutputs,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Model comparison failed.');
      }
      setSubmittedOutputs(Object.fromEntries(completedOutputs.map(row => [row.modelId, row.output])));
      setResult(data);
      setShowForm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model comparison failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Model Behavior Comparison</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Compare how different models respond to the same prompt.
            </p>
            <p className="mt-2 text-xs font-bold text-slate-500">
              Source: user-provided model outputs. No model calls are made by default.
            </p>
          </div>
          <Link href="/playground" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Playground
          </Link>
        </header>

        {!showForm && !result && (
          <section className="rounded-2xl border border-[#E4E3DE] bg-white p-8 shadow-sm">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-black">Model Behavior Comparison</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Compare how different models respond to the same prompt.</p>
              <p className="mt-5 text-sm font-bold text-slate-700">No model comparison has been run yet.</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Paste outputs from multiple models to compare their behavior locally.
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">No model calls are made by default.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => setShowForm(true)}
                  className="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800"
                >
                  Start Manual Comparison
                </button>
                <Link href="/playground" className="rounded-lg border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50">
                  Back to Playground
                </Link>
              </div>
            </div>
          </section>
        )}

        {showForm && (
          <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <div className="grid gap-5">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Original prompt</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                  placeholder="Paste the prompt all models answered..."
                />
              </div>

              <div className="max-w-xs">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400">Expected format</label>
                <select
                  value={expectedFormat}
                  onChange={(event) => setExpectedFormat(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-[#E4E3DE] bg-white px-3 py-2 text-sm font-bold"
                >
                  <option value="">none</option>
                  <option value="text">text</option>
                  <option value="json">json</option>
                  <option value="markdown">markdown</option>
                </select>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Model outputs</h2>
                  <button onClick={addOutput} className="rounded-lg border border-[#E4E3DE] bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50">
                    Add output
                  </button>
                </div>
                {outputs.map((row, index) => (
                  <div key={index} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6]/50 p-4">
                    <div className="flex gap-3">
                      <input
                        value={row.modelName}
                        onChange={(event) => updateOutput(index, { modelName: event.target.value })}
                        className="w-full rounded-lg border border-[#E4E3DE] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-slate-400"
                        placeholder="Model name"
                      />
                      <button
                        onClick={() => removeOutput(index)}
                        disabled={outputs.length <= 2}
                        className="rounded-lg border border-[#E4E3DE] bg-white px-3 py-2 text-xs font-black text-slate-500 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      value={row.output}
                      onChange={(event) => updateOutput(index, { output: event.target.value })}
                      rows={6}
                      className="mt-3 w-full rounded-lg border border-[#E4E3DE] bg-white p-3 font-mono text-sm outline-none focus:border-slate-400"
                      placeholder="Paste this model's output..."
                    />
                  </div>
                ))}
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {error}
                </div>
              )}

              <button
                onClick={runComparison}
                disabled={loading}
                className="self-start rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? 'Running Comparison...' : 'Run Comparison'}
              </button>
            </div>
          </section>
        )}

        {result && (
          <section className="mt-8 space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              {[
                ['Best model', bestModel?.modelName || 'N/A'],
                ['Riskiest model', riskiestModel?.modelName || 'N/A'],
                ['Average safety score', `${result.summary.averageSafetyScore}/100`],
                ['Needs review count', String(result.summary.needsReviewCount)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#E4E3DE] bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="mt-2 text-xl font-black">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div className="border-b border-[#E4E3DE] pb-4">
                <h2 className="text-xl font-black">Model table</h2>
                <div className="mt-2 grid gap-1 text-xs font-semibold text-slate-500 md:grid-cols-3">
                  <p>Safety Score: out of 100; higher means fewer risky findings.</p>
                  <p>Behavior Variance: 0 = identical, 1 = very different.</p>
                  <p>Status: Stable, Needs Review, or High Risk based on findings and variance.</p>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="p-3">Model</th>
                      <th className="p-3">Safety Score</th>
                      <th className="p-3">Behavior Variance</th>
                      <th className="p-3">Findings</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E3DE]">
                    {result.models.map(model => (
                      <tr key={model.modelId}>
                        <td className="p-3 font-black">{model.modelName}</td>
                        <td className="p-3 font-mono font-bold">{model.safetyScore}/100</td>
                        <td className="p-3 font-mono font-bold">{model.behaviorVariance.toFixed(2)}</td>
                        <td className="p-3 font-mono font-bold">{model.findingsCount}</td>
                        <td className="p-3">
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(model.status)}`}>
                            {statusLabel(model.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3">
              {result.models.map(model => (
                <details key={model.modelId} className="rounded-xl border border-[#E4E3DE] bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-black">{model.modelName} details</summary>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Scan result summary</h3>
                      <p className="mt-2 text-sm font-semibold text-slate-600">
                        {model.criticalCount} critical, {model.highCount} high, {model.findingsCount} total findings.
                        Format check: {model.formatPassed ? 'Passed' : 'Failed'}.
                      </p>
                      <div className="mt-3 space-y-2">
                        {model.findings.length ? model.findings.map(finding => (
                          <div key={`${model.modelId}-${finding.rule_id}`} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] p-3">
                            <p className="text-xs font-black uppercase tracking-widest text-slate-500">{finding.severity} · {finding.rule_id}</p>
                            <p className="mt-1 text-sm text-slate-700">{finding.explanation}</p>
                          </div>
                        )) : (
                          <p className="text-sm font-semibold text-slate-500">No findings detected for this output.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Output preview</h3>
                      <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-xs text-slate-700">
                        {submittedOutputs[model.modelId] || 'Output was not saved in this browser session.'}
                      </pre>
                    </div>
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Result JSON</h3>
                      <button
                        onClick={() => navigator.clipboard.writeText(JSON.stringify(model, null, 2))}
                        className="mt-2 rounded-lg border border-[#E4E3DE] bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
                      >
                        Copy result JSON
                      </button>
                      <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                        {JSON.stringify(model, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>

            <details className="rounded-xl border border-[#E4E3DE] bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-black">Full comparison JSON</summary>
              <button
                onClick={() => navigator.clipboard.writeText(resultJson)}
                className="mt-3 rounded-lg border border-[#E4E3DE] bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50"
              >
                Copy comparison JSON
              </button>
              <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {resultJson}
              </pre>
            </details>
          </section>
        )}
      </main>
    </div>
  );
}
