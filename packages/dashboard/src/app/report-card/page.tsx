import Link from 'next/link';
import type { Metadata } from 'next';

type ReportCardPageProps = {
  searchParams?: Promise<{
    score?: string;
    verdict?: string;
    findings?: string;
    owasp?: string;
  }>;
};

export async function generateMetadata({ searchParams }: ReportCardPageProps): Promise<Metadata> {
  const params = await searchParams;
  const score = params?.score || 'pending';
  const verdict = params?.verdict || 'Scan pending';
  const findings = params?.findings || '0';
  const title = score === 'pending'
    ? 'PromptSonar Scan Report'
    : `PromptSonar ${score}/100 - ${verdict}`;
  const description = `PromptSonar found ${findings} finding${findings === '1' ? '' : 's'} and marked this prompt as "${verdict}". OWASP LLM Top 10 mapped.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'PromptSonar',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function ReportCardPage({ searchParams }: ReportCardPageProps) {
  const params = await searchParams;
  const score = params?.score || 'pending';
  const numericScore = Number(score);
  const hasScore = Number.isFinite(numericScore);
  const verdict = params?.verdict || 'Scan pending';
  const findings = params?.findings || '0';
  const labels = (params?.owasp || '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);

  const scoreTone = !hasScore
    ? 'from-slate-500 to-slate-700'
    : numericScore >= 85
    ? 'from-emerald-400 to-teal-600'
    : numericScore >= 70
    ? 'from-amber-300 to-orange-500'
    : 'from-red-400 to-rose-700';

  return (
    <main className="min-h-screen bg-[#F6F1E8] px-5 py-8 text-slate-950">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-[36px] border border-slate-950 bg-slate-950 shadow-2xl">
        <div className={`bg-gradient-to-br ${scoreTone} p-8 text-white md:p-12`}>
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-white/70">PromptSonar Scan Report</p>
              <h1 className="mt-4 text-5xl font-black tracking-tight md:text-7xl">
                {hasScore ? `${numericScore}/100` : 'Pending'}
              </h1>
              <p className="mt-4 max-w-2xl text-lg font-bold text-white/90">
                Verdict: {verdict}
              </p>
            </div>
            <div className="rounded-3xl border border-white/25 bg-white/15 p-5 backdrop-blur">
              <p className="text-xs font-black uppercase tracking-widest text-white/60">Attack Coverage</p>
              <p className="mt-2 text-4xl font-black">{hasScore ? Math.min(10, Math.max(0, Math.round((100 - numericScore) / 10) + (verdict !== 'Protected' ? 3 : 0))) : 0}/10</p>
              <p className="mt-1 text-sm font-bold text-white/75">adversarial patterns caught</p>
            </div>
          </div>
        </div>

        <div className="grid gap-0 bg-white md:grid-cols-[1fr_0.8fr]">
          <div className="p-8 md:p-10">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">OWASP Mapping</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(labels.length ? labels : ['No OWASP risks detected']).map((label) => (
                <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-700">
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-8 rounded-3xl border border-slate-200 bg-[#FAF9F6] p-6">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Summary</p>
              <p className="mt-3 text-lg font-black">
                PromptSonar found {findings} finding{findings === '1' ? '' : 's'} and marked this prompt as “{verdict}.”
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Share this report in GitHub issues, PRs, security reviews, launch posts, or customer evidence packets.
              </p>
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 p-8 md:border-l md:border-t-0 md:p-10">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Badge</p>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-2xl font-black">PromptSonar: {verdict}</p>
              <p className="mt-2 text-sm font-bold text-slate-500">OWASP LLM Top 10 mapped</p>
            </div>
            <Link
              href="/try"
              className="mt-6 inline-flex w-full justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-black uppercase tracking-widest text-white transition hover:bg-slate-800"
            >
              Scan Another Prompt
            </Link>
            <Link
              href="/playground"
              className="mt-3 inline-flex w-full justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-black uppercase tracking-widest text-slate-700 transition hover:bg-slate-50"
            >
              View Full Analysis
            </Link>
          </aside>
        </div>
      </section>
    </main>
  );
}
