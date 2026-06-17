"use client";

import { useState } from "react";
import { SAMPLE_SCAN } from "@/lib/sampleScan";
import { adaptRepositoryReport } from "@/lib/repositoryAdapter";
import {
  UploadScreen,
  type ScanSource,
} from "@/components/repository/UploadScreen";
import { RepoMapScreen } from "@/components/repository/RepoMapScreen";
import {
  FileScreen,
  buildFileMicroscope,
  type FileMicroscope,
} from "@/components/repository/FileScreen";
import type { RepositoryScan } from "@/types/repository";
import type { ExportKind } from "@/components/repository/ExportsPanel";

type Screen = "upload" | "repo" | "file";

// Only read text-ish files in the browser; mirror the API's limits.
const TEXT_FILE_PATTERN =
  /\.(prompt|ai|chat|md|mdx|txt|json|ya?ml|ts|tsx|js|jsx|py|toml|env|config|rules)$/i;
const MAX_FILES = 200;
const MAX_FILE_CHARS = 20_000;

function relPath(file: File): string {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  );
}

function shouldRead(file: File): boolean {
  return (
    TEXT_FILE_PATTERN.test(relPath(file).toLowerCase()) ||
    file.type.startsWith("text/")
  );
}

/**
 * Repository Explorer v2 — screen router. Holds the upload | repo | file
 * state. The demo source loads the bundled sample; folder/file sources run a
 * real scan through /api/repository and adapt the report into the v2 shape.
 */
export default function RepositoryExplorerPage() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [scan, setScan] = useState<RepositoryScan>(SAMPLE_SCAN);
  const [micro, setMicro] = useState<FileMicroscope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function runSample() {
    setError(null);
    setScan({ ...SAMPLE_SCAN, scanMode: "device" });
    setScreen("repo");
  }

  function handleGitHub(url: string) {
    // The browser scan endpoint ingests uploaded files, not a git URL, and
    // there is no clone service wired into this build.
    setError(
      url.trim()
        ? "GitHub URL scanning isn't available in this build. Use Local folder / Upload, or the CLI: npx @promptsonar/cli repo ."
        : "Enter a repository URL, or use Local folder / Upload.",
    );
  }

  async function handleScanFiles(
    files: File[],
    source: ScanSource,
    repoName: string,
  ) {
    setError(null);
    const readable = files.filter(shouldRead).slice(0, MAX_FILES);
    if (readable.length === 0) {
      setError(
        "No readable text files were found in that selection (prompts, configs, code, docs).",
      );
      return;
    }

    setLoading(true);
    try {
      const payload = await Promise.all(
        readable.map(async (file) => ({
          path: relPath(file),
          content: (await file.text()).slice(0, MAX_FILE_CHARS),
        })),
      );

      const res = await fetch("/api/repository", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload, repositoryName: repoName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Scan failed (${res.status})`);

      const adapted = adaptRepositoryReport(data.report, {
        scanMode: source === "github" ? "github" : "device",
        name: repoName,
      });
      setScan(adapted);
      setScreen("repo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenFile(file: string) {
    setMicro(buildFileMicroscope(scan, file));
    setScreen("file");
  }

  function handleExport(kind: ExportKind) {
    // Wiring point for the real export endpoints.
    window.alert(`Export: ${kind}`);
  }

  if (screen === "upload") {
    return (
      <UploadScreen
        onRunSample={runSample}
        onScanFiles={handleScanFiles}
        onGitHub={handleGitHub}
        loading={loading}
        error={error}
      />
    );
  }

  if (screen === "file" && micro) {
    return <FileScreen data={micro} onBack={() => setScreen("repo")} />;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setScreen("upload");
        }}
        className="mx-auto mb-4 block max-w-[920px] font-mono text-[12.5px] text-ink-muted hover:text-ink"
      >
        ← New scan
      </button>
      <RepoMapScreen
        scan={scan}
        onOpenFile={handleOpenFile}
        onExport={handleExport}
      />
    </div>
  );
}
