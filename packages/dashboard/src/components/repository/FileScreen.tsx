"use client";

import type {
  RepositoryScan,
  Provenance,
  Confidence,
} from "@/types/repository";
import { ProvBadge } from "./ProvBadge";
import { ConfBadge } from "./ConfBadge";
import { CodeDiff } from "./CodeDiff";

export interface FileMicroscope {
  file: string;
  provenance: Provenance;
  findingTitle: string; // uppercase rule phrase
  findingConfidence: Confidence; // the eyebrow tier
  findingHeadline: string; // plain-language one-liner
  fileFindingConfidence: Confidence; // "...is [X] by direct evidence"
  pathConfidence: Confidence; // "the full path is [X] — inferred routing"
  route: { source: string; via: string; sinks: string[] };
  whyItMatters: string;
  fixSummary: string;
  before: string;
  after: string;
  expectedEffect: string[];
}

/**
 * Build the microscope view for a file from a scan. The canonical
 * `.cursor/mcp.json` finding matches the spec copy; other files degrade
 * gracefully using the scan's available data.
 */
export function buildFileMicroscope(
  scan: RepositoryScan,
  path: string,
): FileMicroscope {
  const file =
    scan.files.find((f) => f.path === path) ?? scan.files[0];

  if (file.path === ".cursor/mcp.json") {
    return {
      file: file.path,
      provenance: file.provenance,
      findingTitle: "Over-permissioned MCP tool with automatic approval",
      findingConfidence: "confirmed",
      findingHeadline: "This file lets a tool act on your system without asking.",
      fileFindingConfidence: "confirmed",
      pathConfidence: "probable",
      route: {
        source: ".cursor/mcp.json",
        via: "filesystem-mcp",
        sinks: ["Shell", "Filesystem", "Network"],
      },
      whyItMatters:
        'This config gives filesystem-mcp wildcard permissions ("*") and auto-approval, and your reviewer prompt can route to it. If a malicious instruction reaches the agent, the tool can act with your machine’s permissions.',
      fixSummary: "Pin permissions to read-only and turn off auto-approval.",
      before: scan.nextAction.before,
      after: scan.nextAction.after,
      expectedEffect: [
        "Removes automatic approval",
        "Limits access to read-only operations",
        "Breaks the confirmed write path",
      ],
    };
  }

  // Generic fallback for any other file.
  return {
    file: file.path,
    provenance: file.provenance,
    findingTitle: `${file.artifactType} finding`,
    findingConfidence: "probable",
    findingHeadline: file.description,
    fileFindingConfidence: "probable",
    pathConfidence: "potential",
    route: {
      source: file.path,
      via: "filesystem-mcp",
      sinks: ["Filesystem"],
    },
    whyItMatters:
      "This artifact participates in a path that can reach a sensitive action. Review how it is wired before trusting it in production.",
    fixSummary: "Constrain how this artifact routes to sensitive actions.",
    before: scan.nextAction.before,
    after: scan.nextAction.after,
    expectedEffect: [
      "Narrows what the path can reach",
      "Re-scan to confirm the updated graph",
    ],
  };
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-2 border-t border-hairline pt-5 sm:grid-cols-[120px_1fr]">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function RouteChip({ label, sink = false }: { label: string; sink?: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-md px-2.5 py-1 font-mono text-[12px]",
        sink
          ? "border border-danger-line bg-danger-soft text-crit"
          : "border border-hairline bg-white/60 text-ink",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

/**
 * FileScreen — screen 3, the single-file microscope.
 */
export function FileScreen({
  data,
  onBack,
}: {
  data: FileMicroscope;
  onBack?: () => void;
}) {
  return (
    <div className="mx-auto max-w-[820px]">
      <button
        type="button"
        onClick={onBack}
        className="font-mono text-[12.5px] text-ink-muted hover:text-ink"
      >
        ← Back to repository map
      </button>

      {/* Header row */}
      <div className="mt-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
            Playground · Single-file microscope
          </span>
          <ProvBadge provenance={data.provenance} />
        </div>
        <h1 className="mt-1.5 font-mono text-[22px] font-medium text-ink">
          {data.file}
        </h1>
      </div>

      {/* Finding card */}
      <section className="glass mt-5 overflow-hidden rounded-2xl border-l-4 border-l-danger-line">
        <div className="space-y-5 p-6 sm:p-7">
          {/* Confidence eyebrow */}
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-crit">
            <span
              aria-hidden="true"
              className="inline-block h-[7px] w-[7px] rounded-full bg-crit"
            />
            {data.findingConfidence} · {data.findingTitle}
          </p>

          {/* Headline */}
          <h2 className="text-[17px] font-semibold leading-snug text-ink">
            {data.findingHeadline}
          </h2>

          {/* Confidence split */}
          <div className="space-y-1 font-mono text-[12px] leading-relaxed text-ink-muted">
            <div className="flex flex-wrap items-center gap-1.5">
              This file&apos;s finding is
              <ConfBadge confidence={data.fileFindingConfidence} /> by direct
              evidence.
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              The full path to the filesystem is
              <ConfBadge confidence={data.pathConfidence} /> — inferred routing.
            </div>
          </div>

          {/* The route */}
          <Section label="The route">
            <div className="flex flex-wrap items-center gap-1.5">
              <RouteChip label={data.route.source} />
              <span className="text-faint">→</span>
              <RouteChip label={data.route.via} />
              <span className="text-faint">→</span>
              {data.route.sinks.map((s) => (
                <RouteChip key={s} label={s} sink />
              ))}
            </div>
          </Section>

          {/* Why it matters */}
          <Section label="Why it matters">
            <p className="text-[14px] leading-relaxed text-ink">
              {data.whyItMatters}
            </p>
          </Section>

          {/* The fix */}
          <Section label="The fix">
            <p className="text-[14px] leading-relaxed text-ink">
              {data.fixSummary}
            </p>
            <CodeDiff
              className="mt-3"
              before={data.before}
              after={data.after}
              beforeLabel="Before"
              afterLabel="After"
            />

            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
              Expected effect
            </p>
            <ul className="mt-2 space-y-1">
              {data.expectedEffect.map((e) => (
                <li
                  key={e}
                  className="flex gap-2 font-mono text-[12.5px] text-ink"
                >
                  <span className="text-amber">•</span>
                  {e}
                </li>
              ))}
            </ul>

            <p className="mt-4 font-mono text-[11.5px] text-ink-muted">
              Re-scan to verify the updated graph — PromptSonar does not assume a
              fix worked.
            </p>
          </Section>
        </div>
      </section>
    </div>
  );
}

export default FileScreen;
