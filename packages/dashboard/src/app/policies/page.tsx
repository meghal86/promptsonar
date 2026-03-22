export default function PoliciesPage() {
  return (
    <div className="min-h-screen bg-[#07090E] text-slate-200">
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-cyan-900/20 via-[#07090E] to-[#07090E]"></div>
      
      <main className="relative z-10 max-w-5xl mx-auto px-6 py-16">
        <header className="flex justify-between items-center mb-12 border-b border-white/5 pb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Governance Policies</h1>
            <p className="mt-2 text-slate-400">Manage DSL configurations for your organization</p>
          </div>
          <button className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 hover:border-cyan-400 px-5 py-2.5 rounded-lg font-medium transition-all duration-300">
            Import Policy
          </button>
        </header>

        <div className="space-y-4">
          <div className="bg-[#0F131D]/80 backdrop-blur-md rounded-xl p-6 border border-white/5 flex flex-col md:flex-row md:items-center justify-between hover:border-cyan-500/30 transition-colors group">
            <div className="flex-1">
              <div className="flex items-center space-x-3 mb-2">
                <h3 className="text-xl font-semibold text-white">payments-high-risk</h3>
                <span className="text-xs font-mono px-2 py-0.5 bg-slate-800 rounded text-slate-300 border border-slate-700">v1.2</span>
              </div>
              <p className="text-slate-400 text-sm font-mono bg-black/30 p-2 rounded shrink-0 self-start">match path: &quot;payments/**&quot;</p>
            </div>
            <div className="mt-4 md:mt-0 flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-8 text-sm">
              <div className="flex flex-col">
                <span className="text-slate-500 mb-1">Min Score</span>
                <span className="text-emerald-400 font-bold">90+</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 mb-1">Blocked Patterns</span>
                <span className="text-rose-400 font-bold">2 rules</span>
              </div>
              <button className="text-slate-400 hover:text-white transition-colors bg-white/5 px-4 py-2 rounded-lg">
                Edit DSL
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
