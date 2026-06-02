import Link from 'next/link';

const models = [
  { name: 'GPT-4o', drift: '0.12', safety: '96%', status: 'Stable' },
  { name: 'Claude 3.5', drift: '0.08', safety: '98%', status: 'Stable' },
  { name: 'Gemini 1.5', drift: '0.10', safety: '94%', status: 'Needs Review' },
  { name: 'Llama 3.1', drift: '0.10', safety: '92%', status: 'Needs Review' }
];

export default function ModelsPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Model Behavior Comparison</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Compare model safety posture, behavior variance, and scan readiness from the playground evaluation pipeline.
            </p>
            <p className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-slate-500">
              Safety Score is out of 100; higher means fewer risky findings.
            </p>
          </div>
          <Link href="/playground" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Playground
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {models.map((model) => (
            <article key={model.name} className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-black">{model.name}</h2>
                  <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">Scan Ready</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${model.status === 'Stable' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                  {model.status}
                </span>
              </div>
              <div className="mt-8 grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Behavior Variance</p>
                  <p className="mt-2 text-3xl font-black">{model.drift}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">0 = identical, 1 = very different</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Safety Score</p>
                  <p className="mt-2 text-3xl font-black">{model.safety}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">out of 100</p>
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
