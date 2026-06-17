import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repository Explorer · PromptSonar",
  description:
    "See where your repository can go. Deterministic execution-path analysis — no LLM calls.",
};

const NAV: Array<{ label: string; meta: string; active?: boolean }> = [
  { label: "Repository", meta: "execution paths", active: true },
  { label: "Reports", meta: "json · sarif · html" },
  { label: "Settings", meta: "scan policy" },
];

export default function RepositoryExplorerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="repo-explorer-bg min-h-screen font-sans text-ink antialiased">
      {/* Spec fonts. Already loaded globally via globals.css, included here
          for fidelity — Next hoists these into <head>. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <div className="mx-auto flex min-h-screen w-full max-w-[1360px] gap-0">
        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between px-5 py-6 lg:flex">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink font-mono text-[12px] font-medium text-white">
                PS
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-semibold text-ink">
                  PromptSonar
                </span>
                <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
                  Execution paths
                </span>
              </span>
            </div>

            <nav className="mt-8 flex flex-col gap-1">
              {NAV.map((item) => (
                <span
                  key={item.label}
                  className={[
                    "flex flex-col rounded-xl px-3 py-2.5 transition-colors",
                    item.active
                      ? "glass glass-sm"
                      : "hover:bg-white/40",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-[13.5px]",
                      item.active
                        ? "font-semibold text-ink"
                        : "font-medium text-ink-muted",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                    {item.meta}
                  </span>
                </span>
              ))}
            </nav>
          </div>

          <p className="font-mono text-[10.5px] leading-relaxed text-faint">
            Deterministic analysis.
            <br />
            Inferred paths are labeled.
          </p>
        </aside>

        {/* ── Main column ─────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="glass glass-sm sticky top-0 z-20 flex h-14 items-center justify-between rounded-b-2xl px-5">
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-ink-muted">
              <span className="lg:hidden font-semibold text-ink">PromptSonar</span>
              <span className="hidden lg:inline">Repository</span>
              <span className="hidden text-faint lg:inline">/</span>
              <span className="hidden font-medium text-ink lg:inline">Explorer</span>
            </div>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
              Deterministic · no LLM calls
            </span>
          </header>

          <main className="flex-1 px-5 py-6 sm:px-7 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
