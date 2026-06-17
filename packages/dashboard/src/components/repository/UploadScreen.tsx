"use client";

import { useRef, useState } from "react";

export type ScanSource = "demo" | "github" | "zip" | "folder";

const DEVICE_NOTE = "Runs entirely on this device";
const GITHUB_NOTE = "Processed by the configured scan service";

function folderName(files: File[]): string {
  const rel = (files[0] as File & { webkitRelativePath?: string })
    ?.webkitRelativePath;
  return rel ? rel.split("/")[0] : "Selected files";
}

/**
 * UploadScreen — screen 1. Centered hero, a 2x2 source grid (Demo, GitHub,
 * Upload, Local folder), and the CLI bar. Folder and Upload open real
 * pickers and hand the selected files up for scanning.
 */
export function UploadScreen({
  onRunSample,
  onScanFiles,
  onGitHub,
  loading = false,
  error = null,
}: {
  onRunSample?: () => void;
  onScanFiles?: (files: File[], source: ScanSource, repoName: string) => void;
  onGitHub?: (url: string) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const [repoUrl, setRepoUrl] = useState("");
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  function pickFolder(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) onScanFiles?.(files, "folder", folderName(files));
  }
  function pickFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) onScanFiles?.(files, "zip", folderName(files));
  }

  return (
    <div className="mx-auto max-w-[920px] py-6">
      {/* Hero */}
      <h1 className="text-center font-display text-[clamp(22px,2.8vw,30px)] font-normal leading-tight text-ink">
        See where your repository{" "}
        <em className="italic text-amber">can go.</em>
      </h1>
      <p className="mx-auto mt-3 max-w-[58ch] text-center font-mono text-sm text-ink-muted">
        Deterministic analysis, no LLM calls. Inferred paths are explicitly
        labeled.
      </p>

      {loading && (
        <p className="mx-auto mt-5 w-fit rounded-full border border-amber-line bg-amber-soft px-4 py-1.5 font-mono text-[12px] text-high">
          Reading your files and analyzing…
        </p>
      )}
      {error && (
        <p className="mx-auto mt-5 w-fit max-w-[60ch] rounded-lg border border-danger-line bg-danger-soft px-4 py-2 text-center font-mono text-[12px] text-crit">
          {error}
        </p>
      )}

      {/* Hidden inputs for the real pickers */}
      <input
        ref={folderInput}
        type="file"
        className="sr-only"
        onChange={(e) => pickFolder(e.target.files)}
        {...({ webkitdirectory: "true", directory: "true" } as Record<
          string,
          string
        >)}
      />
      <input
        ref={filesInput}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => pickFiles(e.target.files)}
      />

      {/* 2x2 source grid */}
      <fieldset
        disabled={loading}
        className="mt-9 grid grid-cols-1 gap-3.5 disabled:opacity-60 sm:grid-cols-2"
      >
        {/* Demo — primary, amber-accented */}
        <SourceCard
          primary
          eyebrow="Sample · Instant"
          heading="Run the sample scan"
          body="See a full execution-path report on a deliberately risky AI-review repo."
          cta="Run the sample scan →"
          note={DEVICE_NOTE}
          onClick={() => onRunSample?.()}
        />

        {/* GitHub — with text input */}
        <SourceCard
          eyebrow="GitHub"
          heading="Scan a public repository"
          body="Paste a repository URL to analyze its AI instruction wiring."
          cta="Scan repository →"
          note={GITHUB_NOTE}
          onClick={() => onGitHub?.(repoUrl)}
        >
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="github.com/org/repo"
            className="mt-3 w-full rounded-lg border border-hairline bg-white/70 px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-faint focus:border-amber-line"
          />
        </SourceCard>

        {/* Upload files */}
        <SourceCard
          eyebrow="Upload"
          heading="Upload repository files"
          body="Select files from your repository. Nothing leaves your browser."
          cta="Choose files →"
          note={DEVICE_NOTE}
          onClick={() => filesInput.current?.click()}
        />

        {/* Local folder */}
        <SourceCard
          eyebrow="Local folder"
          heading="Pick a local folder"
          body="Select a project directory and analyze it in place."
          cta="Select a folder →"
          note={DEVICE_NOTE}
          onClick={() => folderInput.current?.click()}
        />
      </fieldset>

      {/* CLI bar */}
      <div className="mt-4 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <code className="overflow-x-auto whitespace-nowrap rounded-xl bg-[#211f1d] px-4 py-3 font-mono text-sm text-[#e8e4dc]">
          <span className="text-[#f2c14e]">npx</span> @promptsonar/cli repo .{" "}
          <span className="text-[#f2c14e]">--json</span> --output
          repository-report.json
        </code>
        <button
          type="button"
          disabled={loading}
          onClick={() => folderInput.current?.click()}
          className="shrink-0 rounded-xl bg-ink px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Analyze repository →
        </button>
      </div>
    </div>
  );
}

function SourceCard({
  primary = false,
  eyebrow,
  heading,
  body,
  cta,
  note,
  onClick,
  children,
}: {
  primary?: boolean;
  eyebrow: string;
  heading: string;
  body: string;
  cta: string;
  note: string;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "glass flex flex-col rounded-2xl p-5 text-left transition-shadow hover:shadow-lg",
        primary ? "border border-amber-line bg-[rgba(254,243,199,0.3)]" : "",
      ].join(" ")}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
        {eyebrow}
      </span>
      <span className="mt-2 text-[17px] font-semibold text-ink">{heading}</span>
      <span className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">
        {body}
      </span>

      {children}

      <span
        className={`mt-3 font-mono text-[13px] ${
          primary ? "text-amber" : "text-ink-muted"
        }`}
      >
        {cta}
      </span>
      <span className="mt-2 font-mono text-[11px] text-faint">{note}</span>
    </button>
  );
}

export default UploadScreen;
