import Link from 'next/link';

const futureHistoryColumns = [
  'Prompt name',
  'Risk',
  'Sensitive action reached',
  'Timestamp',
  'Open report',
  'Re-run scan',
  'Compare changes',
];

export default function ScansHistoryPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <Link href="/projects" className="text-sm font-bold text-slate-500 transition hover:text-slate-900">
          Back to Projects
        </Link>

        <header className="border-b border-[#E4E3DE] pb-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">PromptSonar</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">Scan History Coming Soon</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
            PromptSonar does not currently store project scan history.
          </p>
        </header>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white p-6 shadow-sm">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
            Local-first
          </span>
          <h2 className="mt-4 text-2xl font-black">No saved scans are available.</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Future versions will show user scan history only after persistence is connected. No commits, scores, or report rows are fabricated.
          </p>
          <div className="mt-5 grid gap-3 text-sm font-semibold text-slate-700 sm:grid-cols-2">
            {futureHistoryColumns.map(column => (
              <div key={column} className="rounded-xl border border-[#E4E3DE] bg-[#FAF9F6] px-4 py-3">
                {column}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
