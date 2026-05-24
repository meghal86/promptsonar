import Link from 'next/link';

const signals = [
  { label: 'Injection Pressure', value: 'Critical', detail: 'OWASP LLM01 patterns, role overrides, and obfuscated instructions.', tone: 'red' },
  { label: 'Data Exposure', value: 'High', detail: 'Hardcoded credentials, API keys, and sensitive context leakage.', tone: 'amber' },
  { label: 'RAG Trust Boundary', value: 'High', detail: 'Raw user input entering retrieval without validated_query isolation.', tone: 'amber' },
  { label: 'Governance Evidence', value: 'Ready', detail: 'JSON, SARIF, waiver, and review artifacts available for audit trails.', tone: 'emerald' }
];

const timeline = [
  { time: '10:01', event: 'Faulty prompt sample blocked', rule: 'sec_owasp_llm01_injection' },
  { time: '09:45', event: '10-prompt evidence run completed', rule: 'playground_evidence' },
  { time: '09:24', event: 'Responsive overlap audit passed', rule: 'ux_layout_guard' },
  { time: '09:14', event: 'Core security suite passed', rule: '27_tests_passed' }
];

const toneClasses: Record<string, string> = {
  red: 'bg-red-50 text-red-700 border-red-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100'
};

export default function IntelligencePage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1C1917]">
      <main className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar Intelligence</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Threat Intelligence Console</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              A focused view of prompt security signals, attack paths, governance evidence, and model drift coming from the playground scanner.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/playground" className="rounded-full border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Back to Playground
            </Link>
            <Link href="/risk-registry" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
              Open Risk Registry
            </Link>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-4">
          {signals.map((signal) => (
            <article key={signal.label} className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-[#A8A29E]">{signal.label}</p>
              <div className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${toneClasses[signal.tone]}`}>
                {signal.value}
              </div>
              <p className="mt-4 text-sm leading-6 text-[#57534E]">{signal.detail}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <article className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-[#E4E3DE] pb-4">
              <div>
                <h2 className="text-xl font-black">Attack Surface Map</h2>
                <p className="mt-1 text-sm text-[#78716C]">How untrusted input can move through retrieval, tools, and model output.</p>
              </div>
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-red-700">7 hazard flows</span>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ['Inputs', 'User input', 'Context'],
                ['Processing', 'Instructions', 'Tools'],
                ['Outputs', 'Answer', 'Logs']
              ].map(([stage, one, two]) => (
                <div key={stage} className="rounded-2xl border border-[#E4E3DE] bg-[#FAF9F6] p-5">
                  <p className="text-xs font-black uppercase tracking-widest text-[#A8A29E]">{stage}</p>
                  <div className="mt-4 space-y-2">
                    <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{one}</div>
                    <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">{two}</div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">Security Timeline</h2>
            <div className="mt-6 space-y-4">
              {timeline.map((item) => (
                <div key={`${item.time}-${item.event}`} className="grid grid-cols-[54px_1fr] gap-4 border-b border-[#F1F0EC] pb-4 last:border-0">
                  <span className="font-mono text-xs font-bold text-[#A8A29E]">{item.time}</span>
                  <div>
                    <p className="text-sm font-black">{item.event}</p>
                    <p className="mt-1 font-mono text-xs text-[#78716C]">{item.rule}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
