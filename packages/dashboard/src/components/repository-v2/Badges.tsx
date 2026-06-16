import type { RepositoryPathConfidence, RepositoryProvenance, RepositoryRisk } from "@promptsonar/core";

const riskStyles: Record<string, string> = {
  critical: "border-red-800 bg-red-800 text-white",
  high: "border-orange-300 bg-orange-50 text-orange-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  low: "border-sky-300 bg-sky-50 text-sky-800",
  none: "border-emerald-300 bg-emerald-50 text-emerald-800",
};

export function RiskBadge({ risk, label }: { risk: RepositoryRisk | "none" | string; label?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.05em] ${riskStyles[risk] || riskStyles.none}`}>
      {label || (risk === "none" ? "No path risk" : risk)}
    </span>
  );
}

export function ConfidenceBadge({
  confidence,
  prefix,
}: {
  confidence: RepositoryPathConfidence | string;
  prefix?: string;
}) {
  const value = confidence.toLowerCase();
  const styles = value === "confirmed"
    ? "border-stone-400 bg-stone-900 text-white"
    : value === "probable"
      ? "border-orange-300 bg-orange-50 text-orange-800"
      : "border-stone-300 bg-white/60 text-stone-600";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.05em] ${styles}`}>
      {prefix ? `${prefix} · ` : ""}{value}
    </span>
  );
}

export function ProvenanceBadge({ provenance }: { provenance: RepositoryProvenance | string }) {
  const labels: Record<string, string> = {
    production: "Production",
    documentation: "Documentation",
    test: "Test",
    fixture: "Fixture",
    example: "Example",
    generated: "Generated",
    unknown: "Unknown",
  };
  return (
    <span className="inline-flex rounded-md border border-stone-300 bg-white/60 px-2 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.07em] text-stone-600">
      {labels[provenance] || provenance}
    </span>
  );
}
