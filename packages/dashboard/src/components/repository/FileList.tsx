"use client";

import { useState } from "react";
import type { AffectedFile, Severity } from "@/types/repository";
import { Eyebrow } from "./Eyebrow";
import { ProvBadge } from "./ProvBadge";
import { SevBadge } from "./SevBadge";

const SEV_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const INITIAL_VISIBLE = 4;

function RiskPill({ label, severity }: { label: string; severity: Severity }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-faint">
        {label}
      </span>
      <SevBadge severity={severity} size="sm" />
    </span>
  );
}

function FileRow({
  file,
  first,
  onOpenFile,
}: {
  file: AffectedFile;
  first: boolean;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile?.(file.path)}
      className={`group grid w-full grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 py-3 text-left sm:grid-cols-[1fr_auto_auto_auto] sm:items-center ${
        first ? "" : "border-t border-hairline"
      }`}
    >
      {/* Filename + one-phrase description */}
      <span className="col-span-2 min-w-0 sm:col-span-1">
        <span className="block truncate font-mono text-[13.5px] font-medium text-ink">
          {file.path}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
          {file.artifactType} · {file.description}
        </span>
      </span>

      {/* Provenance */}
      <span className="justify-self-start sm:justify-self-center">
        <ProvBadge provenance={file.provenance} />
      </span>

      {/* Path / File risk pills, right-aligned, two lines */}
      <span className="flex flex-col items-end gap-1 justify-self-end">
        <RiskPill label="Path" severity={file.pathRisk} />
        <RiskPill label="File" severity={file.fileFinding} />
      </span>

      {/* Open — fades to amber on row hover */}
      <span className="justify-self-end whitespace-nowrap font-mono text-[12px] text-faint transition-colors group-hover:text-amber">
        Open →
      </span>
    </button>
  );
}

/**
 * FileList — files to fix first, sorted by severity. Compact rows with a
 * one-phrase description (never a full sentence) and a show-more toggle.
 */
export function FileList({
  files,
  onOpenFile,
}: {
  files: AffectedFile[];
  onOpenFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const sorted = [...files].sort(
    (a, b) =>
      SEV_RANK[b.pathRisk] - SEV_RANK[a.pathRisk] ||
      SEV_RANK[b.fileFinding] - SEV_RANK[a.fileFinding],
  );

  const visible = expanded ? sorted : sorted.slice(0, INITIAL_VISIBLE);
  const hidden = sorted.length - INITIAL_VISIBLE;

  return (
    <section className="glass rounded-3xl p-6 sm:p-7">
      <Eyebrow>Files to fix first · sorted by severity</Eyebrow>

      <div className="mt-3">
        {visible.map((file, i) => (
          <FileRow
            key={file.path}
            file={file}
            first={i === 0}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-[12px] text-amber underline underline-offset-2 hover:text-ink"
        >
          {expanded ? "Show fewer files ←" : `+ ${hidden} more files →`}
        </button>
      )}
    </section>
  );
}

export default FileList;
