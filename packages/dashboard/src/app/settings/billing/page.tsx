import Link from 'next/link';

export default function BillingPage() {
  return (
    <div className="min-h-screen bg-[#07090E] text-slate-200">
      <main className="max-w-4xl mx-auto px-6 py-16">
        <Link href="/projects" className="text-indigo-400 hover:text-indigo-300 text-sm mb-8 inline-block transition-colors">
          ← Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-white mb-2">Billing & Plans</h1>
        <p className="text-slate-400 mb-12">Manage your PromptSonar subscription and team seats.</p>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-[#0F131D]/80 border border-white/5 rounded-2xl p-8 hover:border-indigo-500/30 transition-all">
            <h3 className="text-xl font-semibold text-white mb-2">Free Tier</h3>
            <p className="text-slate-400 text-sm mb-6">Local scans and standard CLI access.</p>
            <div className="text-3xl font-bold text-white mb-6">$0<span className="text-lg text-slate-500 font-normal">/mo</span></div>
            <button className="w-full py-2.5 rounded-lg bg-white/5 text-slate-300 cursor-not-allowed">Current Plan</button>
          </div>

          <div className="bg-gradient-to-b from-[#1A1F35] to-[#0F131D]/80 border border-indigo-500/50 rounded-2xl p-8 relative shadow-[0_0_30px_rgba(99,102,241,0.15)]">
            <div className="absolute top-0 right-8 transform -translate-y-1/2 bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg">RECOMMENDED</div>
            <h3 className="text-xl font-semibold text-white mb-2">Pro Seat</h3>
            <p className="text-slate-400 text-sm mb-6">10k cloud scans, SBOM exports, and dashboard access.</p>
            <div className="text-3xl font-bold text-indigo-400 mb-6">$19<span className="text-lg text-slate-500 font-normal">/mo</span></div>
            <button className="w-full py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-all shadow-lg hover:shadow-indigo-500/25">Upgrade to Pro</button>
          </div>
        </div>
      </main>
    </div>
  );
}
