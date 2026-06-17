import type { RepositoryScan, Severity, Confidence } from "@/types/repository";
import { Eyebrow } from "./Eyebrow";

const SEV_TEXT: Record<Severity, string> = {
  critical: "text-crit",
  high: "text-high",
  medium: "text-med",
  low: "text-safe",
  info: "text-neu",
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const TRUST: Record<
  RepositoryScan["verdict"]["trustStatus"],
  { label: string; tone: string }
> = {
  "review-required": { label: "Review required", tone: "text-high" },
  pass: { label: "Pass", tone: "text-safe" },
  fail: { label: "Fail", tone: "text-crit" },
};

const CONF: Record<Confidence, { label: string; tone: string; dot: string }> = {
  confirmed: { label: "Confirmed", tone: "text-ink", dot: "bg-ink border-ink" },
  probable: { label: "Probable", tone: "text-med", dot: "bg-amber border-amber" },
  potential: {
    label: "Potential",
    tone: "text-faint",
    dot: "bg-transparent border-faint",
  },
};

function Indicator({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className="glass-sm inline-flex items-center gap-2 rounded-lg border border-hairline bg-white/55 px-3 py-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
        {label}
      </span>
      <span className={`text-[13px] font-semibold ${tone}`}>{value}</span>
    </span>
  );
}

function TierChip({
  count,
  confidence,
}: {
  count: number;
  confidence: Confidence;
}) {
  const c = CONF[confidence];
  return (
    <span className="glass-sm inline-flex items-center gap-2 rounded-md border border-hairline bg-white/55 px-2.5 py-1 font-mono text-[12px]">
      <span
        aria-hidden="true"
        className={`inline-block h-[7px] w-[7px] rounded-full border ${c.dot}`}
      />
      <span className={c.tone}>
        <b className="font-semibold">{count}</b> {c.label}
      </span>
    </span>
  );
}

/**
 * VerdictCard — top-of-page verdict. Indicator chips, the Playfair verdict
 * headline, the confirmed/inferred summary box, finding tiers, and the
 * coverage + risk-score footer (secondary to the tiers, per spec).
 */
export function VerdictCard({
  scan,
  onShowCoverage,
  onShowRiskFormula,
}: {
  scan: RepositoryScan;
  onShowCoverage?: () => void;
  onShowRiskFormula?: () => void;
}) {
  const { verdict, coverage, findings, riskScore } = scan;

  return (
    <section className="glass rounded-3xl p-6 sm:p-7">
      {/* Indicator chips */}
      <div className="flex flex-wrap gap-2.5">
        <Indicator
          label="Overall Risk"
          value={SEV_LABEL[verdict.overallRisk]}
          tone={SEV_TEXT[verdict.overallRisk]}
        />
        <Indicator
          label="Trust Status"
          value={TRUST[verdict.trustStatus].label}
          tone={TRUST[verdict.trustStatus].tone}
        />
        <Indicator
          label="Path Confidence"
          value={CONF[verdict.highestPathConfidence].label}
          tone={CONF[verdict.highestPathConfidence].tone}
        />
      </div>

      {/* Verdict headline — the only Playfair on this card */}
      <h2 className="mt-6 max-w-[44ch] font-display text-[clamp(19px,2.2vw,24px)] font-normal leading-snug text-ink">
        {verdict.summaryLine}
      </h2>

      {/* Confirmed / inferred summary */}
      <div className="mt-5 rounded-xl border border-amber-line bg-[rgba(254,243,199,0.22)] px-4 py-3 font-mono text-[12.5px] leading-relaxed">
        <p className="flex items-start gap-2 text-ink">
          <span
            aria-hidden="true"
            className="mt-[5px] inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-ink"
          />
          <span>
            <b className="font-semibold">Confirmed:</b> {verdict.confirmedSummary}
          </span>
        </p>
        <p className="mt-1.5 pl-[15px] text-amber">
          <b className="font-semibold">Inferred:</b> {verdict.inferredSummary}
        </p>
      </div>

      {/* Finding tiers */}
      <div className="mt-6 flex flex-wrap items-center gap-2.5">
        <Eyebrow className="mr-1">Findings</Eyebrow>
        <TierChip count={findings.confirmed} confidence="confirmed" />
        <TierChip count={findings.probable} confidence="probable" />
        <TierChip count={findings.potential} confidence="potential" />
      </div>

      {/* Coverage + risk score — secondary, below the tiers */}
      <div className="mt-5 space-y-1.5 font-mono text-[12px] text-ink-muted">
        <p>
          {coverage.considered} considered · {coverage.scanned} scanned ·{" "}
          {coverage.skipped} skipped ·{" "}
          <button
            type="button"
            onClick={onShowCoverage}
            className="text-amber underline underline-offset-2 hover:text-ink"
          >
            details →
          </button>
        </p>
        <p>
          Risk score {riskScore}/100 ·{" "}
          <button
            type="button"
            onClick={onShowRiskFormula}
            className="text-amber underline underline-offset-2 hover:text-ink"
          >
            how it&apos;s calculated →
          </button>
        </p>
      </div>
    </section>
  );
}

export default VerdictCard;
