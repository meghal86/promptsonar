import Link from 'next/link';

const futureFeatures = [
  'scan timeline',
  'risk trends',
  'compare scans',
  'project activity',
  'saved reports',
];

const exportFormats = [
  'Report',
  'Markdown',
  'JSON',
  'SARIF',
];

export default function HistoryPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-4xl font-black tracking-tight">History Coming Soon</h1>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                Local-first
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              PromptSonar currently runs locally and does not store scans.
            </p>
          </div>
          <Link href="/try" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Try page
          </Link>
        </header>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-8 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Why history is unavailable today</p>
            <h2 className="mt-3 text-2xl font-black">No persistent scan database is connected.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              The dashboard does not have cloud storage, team storage, or a persistent scan-history table. PromptSonar will not display fabricated activity, timestamps, events, or trend metrics.
            </p>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">What will be available</p>
            <ul className="mt-4 grid gap-2 text-sm font-semibold text-slate-700">
              {futureFeatures.map(feature => (
                <li key={feature} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2">
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-slate-400">Current export options</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Current scans can be exported manually instead of stored as history.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-black text-slate-700">
              {exportFormats.map(format => (
                <div key={format} className="rounded-lg border border-[#E4E3DE] bg-[#FAF9F6] px-3 py-2">
                  {format}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
