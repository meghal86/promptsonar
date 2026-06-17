import type { RepositoryScan } from "@/types/repository";
import { CodeDiff } from "./CodeDiff";

/**
 * NextActionCard — the single highest-leverage fix, shown with an inline
 * before/after diff. 4px amber left bar; the issue title is Geist 600 (never
 * Playfair).
 */
export function NextActionCard({
  nextAction,
  onOpenFile,
}: {
  nextAction: RepositoryScan["nextAction"];
  onOpenFile?: (file: string) => void;
}) {
  return (
    <section className="glass overflow-hidden rounded-3xl border-l-4 border-l-amber-line">
      <div className="p-6 sm:p-7">
        {/* Eyebrow row */}
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
            Fix first · Effort: {nextAction.effort}
          </span>
          <button
            type="button"
            onClick={() => onOpenFile?.(nextAction.file)}
            className="font-mono text-[12px] text-amber underline underline-offset-2 hover:text-ink"
          >
            Open file →
          </button>
        </div>

        {/* Issue title */}
        <h3 className="mt-3 text-[16px] font-semibold text-ink">
          {nextAction.issueTitle}
        </h3>

        {/* Inline before/after diff */}
        <CodeDiff
          className="mt-4"
          before={nextAction.before}
          after={nextAction.after}
          beforeLabel="Before — high risk"
          afterLabel="After — safe"
        />

        {/* Re-scan note */}
        <p className="mt-3 font-mono text-[11.5px] text-ink-muted">
          Re-scan to verify. PromptSonar does not assume a fix worked.
        </p>
      </div>
    </section>
  );
}

export default NextActionCard;
