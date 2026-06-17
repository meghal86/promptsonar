"use client";

import type { RepositoryScan } from "@/types/repository";
import { VerdictCard } from "./VerdictCard";
import { NextActionCard } from "./NextActionCard";
import { BusinessImpact } from "./BusinessImpact";
import { ExecutionGraph } from "./ExecutionGraph";
import { FileList } from "./FileList";
import { RemediationList } from "./RemediationList";
import { PathBrowser } from "./PathBrowser";
import { EvidenceTable } from "./EvidenceTable";
import { NonProdFindings } from "./NonProdFindings";
import { ExportsPanel, type ExportKind } from "./ExportsPanel";

const BADGE_TEXT: Record<RepositoryScan["scanMode"], string> = {
  device: "RUNS ENTIRELY ON THIS DEVICE · NO UPLOADS",
  github: "REPOSITORY PROCESSED BY THE CONFIGURED SCAN SERVICE",
  cli: "RUNS LOCALLY · NO UPLOADS",
};

const CONF_TONE = {
  confirmed: "text-ink",
  probable: "text-high",
  potential: "text-faint",
} as const;

const CONF_LABEL = {
  confirmed: "Confirmed",
  probable: "Probable",
  potential: "Potential",
} as const;

/**
 * RepoMapScreen — screen 2. Assembles the verdict, next action, business
 * impact, the always-visible execution graph, file list, remediation, and
 * the four collapsed disclosures, in the spec's strict order.
 */
export function RepoMapScreen({
  scan,
  onOpenFile,
  onExport,
}: {
  scan: RepositoryScan;
  onOpenFile?: (file: string) => void;
  onExport?: (kind: ExportKind) => void;
}) {
  const badgeAmber = scan.scanMode === "github";
  const totalPaths = scan.paths.length;

  function showRiskFormula() {
    window.alert(
      [
        "Risk score = weighted blend of:",
        "• highest-confidence reachable sink (severity × confidence)",
        "• number of confirmed routes to sensitive actions",
        "• production-artifact exposure",
        "",
        `This repository scored ${scan.riskScore}/100.`,
      ].join("\n"),
    );
  }

  function showCoverage() {
    const b = scan.coverage.skippedBreakdown;
    window.alert(
      [
        `${scan.coverage.considered} files considered`,
        `${scan.coverage.scanned} scanned · ${scan.coverage.skipped} skipped`,
        "",
        "Skipped breakdown:",
        `• generated ${b.generated}`,
        `• unsupported ${b.unsupported}`,
        `• binary ${b.binary}`,
        `• oversized ${b.oversized}`,
      ].join("\n"),
    );
  }

  function browsePaths() {
    document
      .getElementById("all-paths")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const conf = scan.verdict.highestPathConfidence;

  return (
    <div className="mx-auto max-w-[920px]">
      {/* Mode-aware live badge */}
      <div
        className={[
          "mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em]",
          badgeAmber
            ? "border-amber-badge-line bg-amber-badge text-high"
            : "border-safe-line bg-safe-soft text-safe",
        ].join(" ")}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            badgeAmber ? "bg-high" : "bg-safe"
          }`}
        />
        {BADGE_TEXT[scan.scanMode]}
      </div>

      <div className="flex flex-col gap-5">
        {/* 1 */} <VerdictCard
          scan={scan}
          onShowCoverage={showCoverage}
          onShowRiskFormula={showRiskFormula}
        />
        {/* 2 */} <NextActionCard nextAction={scan.nextAction} onOpenFile={onOpenFile} />
        {/* 3 */} <BusinessImpact items={scan.businessImpact} />

        {/* 4 — execution graph, always visible (never a disclosure) */}
        <div>
          <ExecutionGraph data={scan.graph} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-xs text-ink-muted">
            <span>
              Path confidence{" "}
              <b className={`font-semibold ${CONF_TONE[conf]}`}>
                {CONF_LABEL[conf]}
              </b>
            </span>
            <span>·</span>
            <span>Confirmed: {scan.verdict.confirmedSummary}</span>
            <span>·</span>
            <span>Inferred: {scan.verdict.inferredSummary}</span>
            <span>·</span>
            <button
              type="button"
              onClick={browsePaths}
              className="text-amber underline underline-offset-2 hover:text-ink"
            >
              Browse all {totalPaths} paths →
            </button>
          </div>
        </div>

        {/* 5 */} <FileList files={scan.files} onOpenFile={onOpenFile} />
        {/* 6 */} <RemediationList steps={scan.remediation} />

        {/* 7 — collapsed disclosures */}
        <div id="all-paths" className="scroll-mt-20">
          <PathBrowser paths={scan.paths} totalPaths={totalPaths} />
        </div>
        {/* 8 */} <EvidenceTable evidence={scan.evidence} />
        {/* 9 */} <NonProdFindings groups={scan.nonProductionFindings} />
        {/* 10 */} <ExportsPanel onExport={onExport} />
      </div>
    </div>
  );
}

export default RepoMapScreen;
