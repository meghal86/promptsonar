"use client";

import Link from 'next/link';
import { useMemo, useState } from 'react';

type OutputRow = {
  modelName: string;
  output: string;
};

type Finding = {
  rule_id: string;
  severity: string;
  category?: string;
  explanation?: string;
  message?: string;
  suggested_fix?: string;
  fix?: string;
  workflow?: {
    path?: {
      nodes?: Array<{ type?: string; label?: string }>;
      trustBoundaryCrossed?: boolean;
      privilegedSinkReached?: boolean;
    };
  };
};

type ComparisonModel = {
  modelId: string;
  modelName: string;
  outputHash: string;
  formatPassed: boolean;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  findings: Finding[];
};

type ComparisonResult = {
  id: string;
  createdAt: string;
  outputCount: number;
  baselineModelId?: string;
  models: ComparisonModel[];
};

const initialRows: OutputRow[] = [
  { modelName: '', output: '' },
  { modelName: '', output: '' },
];

function slugModelId(name: string, index: number): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `model-${index + 1}`;
}

function severityRank(severity: string): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  if (severity === 'low') return 1;
  return 0;
}

function highestSeverity(findings: Finding[]): string {
  return findings.reduce((highest, finding) =>
    severityRank(finding.severity) > severityRank(highest) ? finding.severity : highest
  , 'none');
}

function severityBadgeClass(severity: string): string {
  if (severity === 'critical') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'high') return 'border-orange-200 bg-orange-50 text-orange-700';
  if (severity === 'medium') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (severity === 'low') return 'border-slate-200 bg-slate-50 text-slate-600';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function getFindingText(finding: Finding): string {
  return finding.explanation || finding.message || 'PromptSonar flagged this output for review.';
}

function getFixText(finding: Finding): string {
  return finding.suggested_fix || finding.fix || 'Review this behavior before using the output in production.';
}

function workflowSummary(model: ComparisonModel): string {
  const workflows = model.findings
    .map(finding => finding.workflow?.path)
    .filter(Boolean);

  if (workflows.some(path => path?.privilegedSinkReached)) {
    return 'Sensitive action signal';
  }
  if (workflows.some(path => path?.trustBoundaryCrossed)) {
    return 'Trust boundary signal';
  }
  if (workflows.some(path => (path?.nodes || []).length > 0)) {
    return 'Prompt flow signal';
  }
  return 'No high-confidence flow signal';
}

function instructionNotes(model: ComparisonModel): string[] {
  const notes: string[] = [];
  if (!model.formatPassed) {
    notes.push('Output does not match the selected expected format.');
  }
  if (model.findings.some(finding => finding.rule_id.includes('injection'))) {
    notes.push('Output contains instruction-override or jailbreak-like text.');
  }
  if (model.findings.some(finding => finding.rule_id.includes('unbounded') || finding.rule_id.includes('rag'))) {
    notes.push('Output may treat untrusted context or broad access as instructions.');
  }
  if (model.findings.some(finding => finding.rule_id.includes('pii') || finding.rule_id.includes('secret'))) {
    notes.push('Output contains credential-like or sensitive-data patterns.');
  }
  if (notes.length === 0) {
    notes.push('No deterministic instruction-following issue detected in the pasted output.');
  }
  return notes;
}

function riskSummary(model: ComparisonModel): string {
  if (model.criticalCount > 0) return `${model.criticalCount} critical finding${model.criticalCount === 1 ? '' : 's'}`;
  if (model.highCount > 0) return `${model.highCount} high finding${model.highCount === 1 ? '' : 's'}`;
  if (model.findingsCount > 0) return `${model.findingsCount} review finding${model.findingsCount === 1 ? '' : 's'}`;
  return 'No findings detected';
}

export default function ModelsPage() {
  const [prompt, setPrompt] = useState('');
  const [expectedFormat, setExpectedFormat] = useState('');
  const [outputs, setOutputs] = useState<OutputRow[]>(initialRows);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [submittedOutputs, setSubmittedOutputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resultJson = useMemo(() => result ? JSON.stringify(result, null, 2) : '', [result]);
  const resultStats = useMemo(() => {
    const models = result?.models || [];
    return {
      outputsCompared: models.length,
      outputsWithFindings: models.filter(model => model.findingsCount > 0).length,
      formatDifferences: models.filter(model => !model.formatPassed).length,
      highestSeverity: highestSeverity(models.flatMap(model => model.findings)),
    };
  }, [result]);

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
      setError('Paste the original prompt before running comparison.');
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
      setError('Add at least two model outputs.');
      return;
    }

    const incomplete = completedOutputs.find(row => !row.modelName || !row.output);
    if (incomplete) {
      setError('Every model output needs both a model name and pasted output text.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model comparison failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Experimental
              </span>
            </div>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Model Comparison</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Compare how different AI models respond to the same prompt.
            </p>
            <p className="mt-2 text-sm font-bold text-slate-700">
              PromptSonar never calls models automatically.
            </p>
          </div>
          <Link href="/playground" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Playground
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-900 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Mode 1</p>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                Available Now
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-black">Manual Comparison</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Paste one prompt and multiple model outputs. PromptSonar analyzes the pasted text locally for safety differences, instruction-following differences, format differences, risky behaviors, and prompt-flow signals.
            </p>
          </div>

          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Mode 2</p>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                Future Release
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-black">Bring Your Own API Keys</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Run OpenAI, Anthropic, Google, OpenRouter, Ollama, and Azure OpenAI models directly from PromptSonar using your own API keys.
            </p>
            <ul className="mt-4 grid gap-2 text-sm font-semibold text-slate-600 sm:grid-cols-2">
              {[
                'OpenAI',
                'Anthropic',
                'Google',
                'OpenRouter',
                'Ollama',
                'Azure OpenAI',
                'real model execution',
                'side-by-side outputs',
                'behavior variance',
                'safety comparison',
                'prompt flow comparison',
                'export reports',
              ].map(item => (
                <li key={item} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-2 border-b border-[#E4E3DE] pb-4">
            <h2 className="text-xl font-black">Manual Comparison</h2>
            <p className="text-sm leading-6 text-slate-600">
              All analysis below comes from text you paste. PromptSonar does not execute models, rank providers, or infer hidden model behavior.
            </p>
          </div>

          <div className="grid gap-5">
            {!result && (
              <div className="rounded-xl border border-dashed border-[#D6D3D1] bg-[#FAF9F6] px-4 py-3">
                <h3 className="text-sm font-black text-slate-950">No model comparison available.</h3>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-600">
                  Run a manual comparison with pasted outputs today. BYOK live model execution is coming soon.
                </p>
              </div>
            )}

            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400">Original prompt</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                className="mt-2 w-full rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4 font-mono text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                placeholder="Paste the exact prompt given to each model..."
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
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Pasted model outputs</h3>
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
                      placeholder="Model name, e.g. GPT-4.1, Claude, Gemini, local model"
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

        {result && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 border-b border-[#E4E3DE] pb-4">
                <h2 className="text-xl font-black">Comparison Results</h2>
                <p className="text-sm leading-6 text-slate-600">
                  Deterministic review of pasted outputs only. These are not provider benchmark scores.
                </p>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-4">
                {[
                  ['Outputs compared', String(resultStats.outputsCompared)],
                  ['Outputs with findings', String(resultStats.outputsWithFindings)],
                  ['Format differences', String(resultStats.formatDifferences)],
                  ['Highest severity', resultStats.highestSeverity],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                    <p className="mt-2 text-xl font-black capitalize">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              {result.models.map(model => {
                const severity = highestSeverity(model.findings);
                return (
                  <article key={model.modelId} className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-[#E4E3DE] pb-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-black">{model.modelName}</h3>
                        <p className="mt-1 font-mono text-[11px] font-bold text-slate-400">Output hash: {model.outputHash.slice(0, 16)}</p>
                      </div>
                      <span className={`self-start rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${severityBadgeClass(severity)}`}>
                        {severity === 'none' ? 'No findings' : severity}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Safety differences</p>
                        <p className="mt-2 text-sm font-bold text-slate-800">{riskSummary(model)}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600">
                          Based on PromptSonar rules matched against this pasted output.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Format differences</p>
                        <p className="mt-2 text-sm font-bold text-slate-800">{model.formatPassed ? 'Selected format satisfied' : 'Selected format not satisfied'}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600">
                          Format checks use the expected format selector above.
                        </p>
                      </div>

                      <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prompt flow differences</p>
                        <p className="mt-2 text-sm font-bold text-slate-800">{workflowSummary(model)}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600">
                          Flow signals come only from findings that include workflow evidence.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl border border-[#E4E3DE] bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Instruction-following notes</p>
                        <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                          {instructionNotes(model).map(note => (
                            <li key={note} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2">
                              {note}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-xl border border-[#E4E3DE] bg-white p-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pasted output preview</p>
                        <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] p-3 text-xs text-slate-700 whitespace-pre-wrap">
                          {submittedOutputs[model.modelId] || 'Output was not saved in this browser session.'}
                        </pre>
                      </div>
                    </div>

                    <details className="mt-4 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                      <summary className="cursor-pointer text-sm font-black">Risky behaviors and findings</summary>
                      <div className="mt-3 space-y-2">
                        {model.findings.length ? model.findings.map(finding => (
                          <div key={`${model.modelId}-${finding.rule_id}-${getFindingText(finding)}`} className="rounded-lg border border-[#E4E3DE] bg-white p-3">
                            <p className="text-xs font-black uppercase tracking-widest text-slate-500">{finding.severity} · {finding.rule_id}</p>
                            <p className="mt-1 text-sm text-slate-700">{getFindingText(finding)}</p>
                            <p className="mt-2 text-xs font-bold text-slate-500">{getFixText(finding)}</p>
                          </div>
                        )) : (
                          <p className="text-sm font-semibold text-slate-500">No risky behavior findings detected in this pasted output.</p>
                        )}
                      </div>
                    </details>
                  </article>
                );
              })}
            </div>

            <details className="rounded-xl border border-[#E4E3DE] bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-black">Full deterministic comparison JSON</summary>
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
