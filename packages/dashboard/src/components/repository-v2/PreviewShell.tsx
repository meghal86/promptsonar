import type { ReactNode } from "react";

export function PreviewShell({
  children,
  active,
  crumb,
  scanMode,
  repositoryHref = "/repository-v2",
  playgroundHref = "/playground-v4",
}: {
  children: ReactNode;
  active: "repository" | "playground";
  crumb: string;
  scanMode?: string;
  repositoryHref?: string;
  playgroundHref?: string;
}) {
  const showInternalPreviewNav = process.env.NODE_ENV !== "production";
  const modeLabel = scanMode === "browser-bounded"
    ? "Browser-bounded scan · no LLM calls"
    : scanMode === "local"
      ? "Local scan · no uploads · no LLM calls"
      : "Deterministic analysis · no LLM calls";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(92,151,188,0.18),transparent_31%),radial-gradient(circle_at_90%_2%,rgba(211,157,49,0.16),transparent_34%),linear-gradient(180deg,#eef0ec_0%,#f5f2ec_58%,#eef2eb_100%)] text-stone-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-stone-900/10 bg-white/45 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <a href="/" className="flex items-center gap-3 px-2 text-[15px] font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-stone-900 font-mono text-[13px] text-amber-300">PS</span>
          PromptSonar
        </a>
        <p className="mt-9 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">AI execution analysis</p>
        <nav className="mt-3 space-y-1" aria-label="Preview navigation">
          <a
            href={repositoryHref}
            className={`block rounded-xl px-3 py-2.5 text-[14px] font-medium ${active === "repository" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white/60 hover:text-stone-900"}`}
          >
            Repository map
          </a>
          <a
            href={playgroundHref}
            className={`block rounded-xl px-3 py-2.5 text-[14px] font-medium ${active === "playground" ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-white/60 hover:text-stone-900"}`}
          >
            File microscope
          </a>
          {showInternalPreviewNav && (
            <>
              <a href="/repository" className="block rounded-xl px-3 py-2.5 text-[14px] font-medium text-stone-500 hover:bg-white/60 hover:text-stone-900">
                Current repository page
              </a>
              <a href="/playground" className="block rounded-xl px-3 py-2.5 text-[14px] font-medium text-stone-500 hover:bg-white/60 hover:text-stone-900">
                Current playground
              </a>
            </>
          )}
        </nav>
        {showInternalPreviewNav && (
          <div className="mt-auto border-t border-stone-900/10 px-3 pt-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-stone-400">Preview route</p>
            <p className="mt-2 text-[12px] leading-5 text-stone-500">Existing production pages remain unchanged.</p>
          </div>
        )}
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-4 border-b border-stone-900/10 bg-[#f7f5f1]/75 px-5 py-3 backdrop-blur-xl sm:px-8">
          <div className="min-w-0 truncate font-mono text-[12px] text-stone-500">
            <span className="font-medium text-stone-900">Audits</span>
            <span className="px-2 text-stone-300">/</span>
            {crumb}
          </div>
          <div className="shrink-0 rounded-full border border-emerald-700/20 bg-emerald-50/75 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-emerald-800">
            {modeLabel}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
