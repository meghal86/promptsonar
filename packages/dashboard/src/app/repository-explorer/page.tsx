"use client";

import { useState } from "react";
import { SAMPLE_SCAN } from "@/lib/sampleScan";
import { UploadScreen, type ScanSource } from "@/components/repository/UploadScreen";
import { RepoMapScreen } from "@/components/repository/RepoMapScreen";
import {
  FileScreen,
  buildFileMicroscope,
  type FileMicroscope,
} from "@/components/repository/FileScreen";
import type { RepositoryScan } from "@/types/repository";
import type { ExportKind } from "@/components/repository/ExportsPanel";

type Screen = "upload" | "repo" | "file";

/**
 * Repository Explorer v2 — screen router. Holds the upload | repo | file
 * state and threads the scan + navigation callbacks between screens.
 * Seeded with the sample scan; the GitHub mode flips the live badge.
 */
export default function RepositoryExplorerPage() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [scan, setScan] = useState<RepositoryScan>(SAMPLE_SCAN);
  const [micro, setMicro] = useState<FileMicroscope | null>(null);

  function handleAnalyze(source: ScanSource) {
    // All sources run the sample scan in this build; GitHub keeps the
    // configured-service scan mode so the live badge reflects it.
    setScan(
      source === "github"
        ? { ...SAMPLE_SCAN, scanMode: "github" }
        : { ...SAMPLE_SCAN, scanMode: "device" },
    );
    setScreen("repo");
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
    return <UploadScreen onAnalyze={handleAnalyze} />;
  }

  if (screen === "file" && micro) {
    return <FileScreen data={micro} onBack={() => setScreen("repo")} />;
  }

  return (
    <RepoMapScreen
      scan={scan}
      onOpenFile={handleOpenFile}
      onExport={handleExport}
    />
  );
}
