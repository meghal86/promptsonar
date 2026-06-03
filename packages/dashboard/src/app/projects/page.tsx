import Link from 'next/link';

const projects = [
  { id: 1, name: 'Payment Service', repo: 'github.com/org/payment-service', score: 95, status: 'Protected', lastScan: '2h ago' },
  { id: 2, name: 'Support Agent', repo: 'github.com/org/support-agent', score: 88, status: 'Watch', lastScan: '4h ago' },
  { id: 3, name: 'RAG Gateway', repo: 'github.com/org/rag-gateway', score: 79, status: 'Needs review', lastScan: '1d ago' }
];

export default function ProjectsPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto max-w-7xl px-6 py-12">
        <header className="mb-10 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar Overview</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Project Security Command Center</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              Overview of prompt-security status across apps, agents, and repositories.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              disabled
              className="cursor-not-allowed rounded-full bg-slate-200 px-5 py-2.5 text-sm font-bold text-slate-500 shadow-sm"
              title="Project creation requires persistence to be connected first."
            >
              Project creation pending
            </button>
          </div>
        </header>

        <section className="mb-8 rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-sm">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-[#A8A29E]">Compare Playgrounds</div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#57534E]">
            Open each generation of the prompt-security playground side by side to compare layout, depth, and the workflow-provenance engine.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link
              href="/playground1"
              className="group flex flex-col gap-1 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-4 py-3 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md"
            >
              <span className="text-sm font-black tracking-tight text-slate-900">Playground 1</span>
              <span className="text-xs font-medium text-[#78716C]">Original input-first layout · explainability-led</span>
            </Link>
            <Link
              href="/playground"
              className="group flex flex-col gap-1 rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-4 py-3 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md"
            >
              <span className="text-sm font-black tracking-tight text-slate-900">Playground 2</span>
              <span className="text-xs font-medium text-[#78716C]">Workflow-first redesign · dense enterprise blocks</span>
            </Link>
            <Link
              href="/playground3"
              className="group flex flex-col gap-1 rounded-xl border border-slate-900 bg-slate-900 px-4 py-3 text-white transition hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-md"
            >
              <span className="flex items-center gap-2 text-sm font-black tracking-tight">
                Playground 3
                <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">Latest</span>
              </span>
              <span className="text-xs font-medium text-slate-300">Best of 1 + 2 · live provenance engine</span>
            </Link>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-sm leading-6 text-amber-900">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">Demo workspace data</div>
          <p className="mt-2 max-w-4xl">
            These project cards are static seed data rendered by the local dashboard. PromptSonar is not currently saving projects to a database or loading them from GitHub; real persistence should be added before this page is presented as a production project inventory.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}/scans`}>
              <article className="group rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] p-3">
                    <svg className="h-6 w-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider ${
                    project.score >= 90 ? 'bg-emerald-50 text-emerald-700' : project.score >= 80 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                  }`}>
                    Score {project.score}
                  </span>
                </div>
                <h2 className="mt-6 text-xl font-black tracking-tight group-hover:text-slate-700">{project.name}</h2>
                <p className="mt-2 font-mono text-xs font-bold text-[#78716C]">{project.repo}</p>
                <div className="mt-6 flex items-center justify-between border-t border-[#E4E3DE] pt-4 text-sm">
                  <span className="font-bold text-[#78716C]">Last scan: {project.lastScan}</span>
                  <span className="font-black text-slate-900 transition group-hover:translate-x-1">View Scans &rarr;</span>
                </div>
              </article>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
