import type { RemediationStep } from "@/types/repository";
import { Eyebrow } from "./Eyebrow";

type Level = "high" | "medium" | "low";

const LEVEL_TONE: Record<Level, string> = {
  high: "text-high",
  medium: "text-med",
  low: "text-safe",
};

const LEVEL_LABEL: Record<Level, string> = {
  high: "High",
  medium: "Med",
  low: "Low",
};

function Tag({ label, level }: { label: string; level: Level }) {
  return (
    <span className="glass-sm inline-flex items-center gap-1.5 rounded-md border border-hairline bg-white/55 px-2.5 py-1 font-mono text-[11px]">
      <span className="uppercase tracking-[0.08em] text-faint">{label}</span>
      <b className={`font-semibold ${LEVEL_TONE[level]}`}>
        {LEVEL_LABEL[level]}
      </b>
    </span>
  );
}

function Step({ step }: { step: RemediationStep }) {
  return (
    <li className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 py-4 first:pt-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-hairline sm:grid-cols-[auto_1fr_auto] sm:items-center">
      {/* Number */}
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-ink text-[14px] font-semibold text-white">
        {step.order}
      </span>

      {/* Title + code/file hint */}
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-snug text-ink">
          {step.title}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[12px] text-ink-muted">
          {step.codeHint} <span className="text-faint">in</span> {step.fileHint}
        </span>
      </span>

      {/* Impact / Effort tags */}
      <span className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-self-end">
        <Tag label="Impact" level={step.impact} />
        <Tag label="Effort" level={step.effort} />
      </span>
    </li>
  );
}

/**
 * RemediationList — ordered changes that close the high-risk path. Numbered
 * steps with a one-line code/file hint and Impact/Effort tags.
 */
export function RemediationList({ steps }: { steps: RemediationStep[] }) {
  const ordered = [...steps].sort((a, b) => a.order - b.order);

  return (
    <section className="glass rounded-3xl p-6 sm:p-7">
      <Eyebrow>
        Remediation · {ordered.length}{" "}
        {ordered.length === 1 ? "change closes" : "changes close"} the high-risk path
      </Eyebrow>

      <ol className="mt-4">
        {ordered.map((step) => (
          <Step key={step.order} step={step} />
        ))}
      </ol>
    </section>
  );
}

export default RemediationList;
