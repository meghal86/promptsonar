import Link from 'next/link';

export default function ScansHistoryPage() {
  return (
    <div className="min-h-screen bg-[#07090E] text-slate-200">
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-indigo-900/10 to-[#07090E]"></div>
      
      <main className="relative z-10 max-w-5xl mx-auto px-6 py-12">
        <Link href="/projects" className="text-indigo-400 hover:text-indigo-300 text-sm mb-8 inline-block transition-colors">
          ← Back to Projects
        </Link>
        
        <header className="flex justify-between items-end mb-10 pb-6 border-b border-white/5">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Payment Service 1</h1>
            <p className="mt-1 text-slate-400">Scan History & BOMs</p>
          </div>
          <button className="bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm border border-white/10 transition-colors shadow-lg">
            Trigger Scan
          </button>
        </header>

        <div className="bg-[#0F131D]/90 border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 text-slate-400 text-sm border-b border-white/5">
                <th className="p-4 font-medium">Commit</th>
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Score</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[1,2,3,4,5].map((i) => (
                <tr key={i} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="p-4 font-mono text-sm text-indigo-300">fb29a{i}c</td>
                  <td className="p-4 text-sm text-slate-400">Mar {25 - i}, 2026</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${i===3 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${i===3 ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'}`}></span>
                      <span>{i===3 ? '64 (Failed)' : '98 (Pass)'}</span>
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-3">
                    <button className="text-xs text-slate-400 hover:text-white transition-colors">View Report</button>
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">Download SBOM</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
