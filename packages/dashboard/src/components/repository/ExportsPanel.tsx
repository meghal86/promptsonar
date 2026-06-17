import { Disclosure } from "./Disclosure";

export type ExportKind =
  | "json"
  | "sarif"
  | "html"
  | "markdown"
  | "github-comment";

const ACTIONS: Array<{ kind: ExportKind; icon: string; label: string }> = [
  { kind: "json", icon: "{ }", label: "Download JSON" },
  { kind: "sarif", icon: "[ ]", label: "Download SARIF" },
  { kind: "html", icon: "</>", label: "Download HTML report" },
  { kind: "markdown", icon: "M↓", label: "Copy Markdown summary" },
  { kind: "github-comment", icon: "❝", label: "Copy GitHub comment" },
];

/**
 * ExportsPanel — CI-ready downloads and copy-paste summaries, inside a
 * collapsed Disclosure. Ghost buttons with an amber mono icon prefix.
 */
export function ExportsPanel({
  onExport,
}: {
  onExport?: (kind: ExportKind) => void;
}) {
  return (
    <Disclosure
      title="Take the report with you"
      subtitle="CI-ready formats and copy-paste summaries"
    >
      <div className="mt-1 flex flex-wrap gap-2.5">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => onExport?.(a.kind)}
            className="glass-sm inline-flex items-center gap-2.5 rounded-xl border border-hairline bg-white/45 px-3.5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:border-amber-line hover:bg-white/70"
          >
            <span className="font-mono text-[12px] text-amber">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </Disclosure>
  );
}

export default ExportsPanel;
