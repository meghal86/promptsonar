import Link from 'next/link';

const policies = [
  {
    name: 'payments-high-risk',
    version: 'v1.2',
    match: 'payments/**',
    minScore: '90+',
    blockedPatterns: '2 rules',
    status: 'Enforced',
    rules: ['max_critical: 0', 'max_high: 2']
  },
  {
    name: 'prompt-injection-gate',
    version: 'v1.0',
    match: 'agents/**',
    minScore: '85+',
    blockedPatterns: 'LLM01',
    status: 'Active',
    rules: ['block: sec_owasp_llm01_injection', 'block: sec_zero_width_injection']
  }
];

export default function PoliciesPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-10 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">Security Policies</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Your Rules</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              Manage rule-based guardrails that decide when prompts pass, warn, or block before they ship.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/playground" className="rounded-full border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Back to Playground
            </Link>
            <button className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
              Import Policy
            </button>
          </div>
        </header>

        <section className="grid gap-4">
          {policies.map((policy) => (
            <article key={policy.name} className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-black tracking-tight">{policy.name}</h2>
                    <span className="rounded-full border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-1 font-mono text-xs font-bold text-[#57534E]">
                      {policy.version}
                    </span>
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-700">
                      {policy.status}
                    </span>
                  </div>
                  <p className="mt-3 inline-flex rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2 font-mono text-xs font-bold text-[#57534E]">
                    match path: &quot;{policy.match}&quot;
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[430px]">
                  <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Min Score</p>
                    <p className="mt-2 text-2xl font-black text-emerald-700">{policy.minScore}</p>
                    <p className="mt-1 text-[10px] font-semibold text-[#78716C]">Safety Score threshold, out of 100.</p>
                  </div>
                  <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Blocked</p>
                    <p className="mt-2 text-2xl font-black text-red-700">{policy.blockedPatterns}</p>
                  </div>
                  <button className="rounded-xl border border-[#E4E3DE] bg-white p-4 text-left transition hover:bg-slate-50">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Action</p>
                    <p className="mt-2 text-sm font-black text-slate-900">Edit Rules</p>
                  </button>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Policy Rules</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {policy.rules.map((rule) => {
                    const plainLabel = rule === 'max_critical: 0'
                      ? 'No critical findings allowed'
                      : rule === 'max_high: 2'
                      ? 'Max 2 high-severity findings'
                      : null;
                    return (
                      <div key={rule} className="flex flex-col gap-1">
                        {plainLabel && (
                          <span className="rule-plain-label text-[10px] font-semibold text-[#78716C]">
                            {plainLabel}
                          </span>
                        )}
                        <span className="rounded-lg border border-[#E4E3DE] bg-white px-3 py-2 font-mono text-xs font-bold text-[#57534E]">
                          {rule}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
