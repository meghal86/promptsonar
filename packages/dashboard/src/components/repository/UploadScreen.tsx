"use client";

import { useState } from "react";

export type ScanSource = "demo" | "github" | "zip" | "folder";

const DEVICE_NOTE = "Runs entirely on this device";
const GITHUB_NOTE = "Processed by the configured scan service";

/**
 * UploadScreen — screen 1. Centered hero, a 2x2 source grid (Demo, GitHub,
 * Upload .zip, Local folder), and the CLI bar with the primary analyze
 * action.
 */
export function UploadScreen({
  onAnalyze,
}: {
  onAnalyze?: (source: ScanSource, value?: string) => void;
}) {
  const [repoUrl, setRepoUrl] = useState("");

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

      {/* 2x2 source grid */}
      <div className="mt-9 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {/* Demo — primary, amber-accented */}
        <SourceCard
          primary
          eyebrow="Sample · Instant"
          heading="Run the sample scan"
          body="See a full execution-path report on a deliberately risky AI-review repo."
          cta="Run the sample scan →"
          note={DEVICE_NOTE}
          onClick={() => onAnalyze?.("demo")}
        />

        {/* GitHub — with text input */}
        <SourceCard
          eyebrow="GitHub"
          heading="Scan a public repository"
          body="Paste a repository URL to analyze its AI instruction wiring."
          cta="Scan repository →"
          note={GITHUB_NOTE}
          onClick={() => onAnalyze?.("github", repoUrl)}
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

        {/* Upload .zip */}
        <SourceCard
          eyebrow="Upload"
          heading="Upload a .zip"
          body="Drop in an archive of your repository. Nothing leaves your browser."
          cta="Choose a .zip →"
          note={DEVICE_NOTE}
          onClick={() => onAnalyze?.("zip")}
        />

        {/* Local folder */}
        <SourceCard
          eyebrow="Local folder"
          heading="Pick a local folder"
          body="Select a project directory and analyze it in place."
          cta="Select a folder →"
          note={DEVICE_NOTE}
          onClick={() => onAnalyze?.("folder")}
        />
      </div>

      {/* CLI bar */}
      <div className="mt-4 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <code className="overflow-x-auto whitespace-nowrap rounded-xl bg-[#211f1d] px-4 py-3 font-mono text-sm text-[#e8e4dc]">
          <span className="text-[#f2c14e]">npx</span> @promptsonar/cli repo .{" "}
          <span className="text-[#f2c14e]">--json</span> --output
          repository-report.json
        </code>
        <button
          type="button"
          onClick={() => onAnalyze?.("demo")}
          className="shrink-0 rounded-xl bg-ink px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
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
