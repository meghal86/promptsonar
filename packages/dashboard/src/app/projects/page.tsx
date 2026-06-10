import Link from 'next/link';

const futureProjectFeatures = [
  'saved repository scans',
  'execution-path trends',
  'project-level reports',
  'scan comparison',
  'team activity',
  'saved SBOM exports',
];

export default function ProjectsPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Projects Coming Soon</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              PromptSonar currently runs local scans and does not store project inventories.
            </p>
            <p className="mt-2 text-sm font-bold text-slate-700">
              No project cards, scores, timestamps, or repository names are fabricated.
            </p>
          </div>
          <Link href="/try" className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
            Scan Prompt or Repository
          </Link>
        </header>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
            Coming Soon
          </span>
          <h2 className="mt-4 text-2xl font-black">Project history requires persistence.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Future versions will show real projects only after PromptSonar can save scans for a repository, team, or workspace.
          </p>
          <div className="mt-5 grid gap-3 text-sm font-semibold text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
            {futureProjectFeatures.map(feature => (
              <div key={feature} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-4 py-3">
                {feature}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Current local workflow</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Run real repository analysis locally, then export the report format you need.
          </p>
          <code className="mt-4 block rounded-xl bg-slate-950 p-4 font-mono text-sm font-bold text-slate-100">
            npx @promptsonar/cli scan .
          </code>
        </section>
      </main>
    </div>
  );
}
