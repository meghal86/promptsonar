import Link from 'next/link';

export default function ProjectsPage() {
  return (
    <div className="min-h-screen bg-[#07090E] text-slate-200 selection:bg-indigo-500/30 font-sans">
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-[#07090E] to-[#07090E]"></div>
      
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <header className="flex justify-between items-center mb-16">
          <div>
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400 tracking-tight">
              PromptSonar
            </h1>
            <p className="mt-2 text-slate-400 text-lg">Manage your project security scans</p>
          </div>
          <button className="bg-indigo-500 hover:bg-indigo-400 text-white px-6 py-2.5 rounded-full font-medium transition-all duration-300 shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] transform hover:-translate-y-0.5">
            + New Project
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((id) => (
            <Link key={id} href={`/projects/${id}/scans`}>
              <div className="group relative bg-[#0F131D]/80 backdrop-blur-xl border border-white/5 rounded-2xl p-6 hover:bg-[#151A28]/90 transition-all duration-500 cursor-pointer overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div className="p-3 bg-indigo-500/10 rounded-xl">
                    <svg className="w-6 h-6 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <span className="flex items-center space-x-1 text-xs font-semibold px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Score 95</span>
                  </span>
                </div>
                <h3 className="text-xl font-bold text-white mb-2 relative z-10 group-hover:text-indigo-300 transition-colors">Payment Service {id}</h3>
                <p className="text-slate-400 text-sm mb-6 relative z-10">github.com/org/payment-service-{id}</p>
                
                <div className="flex justify-between items-center text-sm border-t border-white/5 pt-4 mt-auto relative z-10">
                  <span className="text-slate-500">Last scan: 2h ago</span>
                  <span className="text-indigo-400 group-hover:translate-x-1 transition-transform duration-300">View Scans →</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
