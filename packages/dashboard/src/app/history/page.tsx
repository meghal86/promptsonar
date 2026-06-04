import Link from 'next/link';

const events = [
  { time: '09:45', event: '10-prompt evidence run completed', result: '8 risk signals, 4 hard fails' },
  { time: '09:24', event: 'Playground overlap audit', result: '0 overlaps, 0 horizontal overflow' },
  { time: '09:14', event: 'Core security tests', result: '27 tests passed' },
  { time: '09:04', event: 'README screenshot refresh', result: 'Clean and vulnerable states captured' }
];

export default function HistoryPage() {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-950">
      <main className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-10 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">PromptSonar</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Scan History</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Recent playground and scanner activity for the local demo workspace.
            </p>
          </div>
          <Link href="/try" className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            Back to Try page
          </Link>
        </header>

        <section className="rounded-2xl border border-[#E4E3DE] bg-white shadow-sm">
          {events.map((item, index) => (
            <div key={item.event} className={`grid gap-4 p-6 md:grid-cols-[90px_1fr_220px] ${index !== events.length - 1 ? 'border-b border-[#E4E3DE]' : ''}`}>
              <div className="font-mono text-sm font-bold text-slate-400">{item.time}</div>
              <div>
                <h2 className="font-black">{item.event}</h2>
                <p className="mt-1 text-sm text-slate-500">Scan</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">{item.result}</div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
