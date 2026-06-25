import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("repository v2 and playground v4 production behavior", () => {
  it("uses accurate folder-upload privacy labels and disabled GitHub semantics", () => {
    const source = read("src/components/repository-v2/RepositoryExplorer.tsx");
    expect(source).toContain("Folder upload");
    expect(source).toContain("Selected eligible text files are sent to this dashboard service");
    expect(source).toContain("Copy command");
    expect(source).toContain("disabled={loading || !githubUrl.trim()}");
    expect(source).not.toContain("Local folder");
  });

  it("hides preview-only navigation in production", () => {
    const source = read("src/components/repository-v2/PreviewShell.tsx");
    expect(source).toContain('process.env.NODE_ENV !== "production"');
    expect(source).toContain("showInternalPreviewNav &&");
  });

  it("keeps microscope investigation state and accessibility hooks wired", () => {
    const source = read("src/components/repository-v2/PlaygroundMicroscope.tsx");
    expect(source).toContain("popstate");
    expect(source).toContain("aria-pressed");
    expect(source).toContain("repositoryBackHref(report)");
    expect(source).toContain('query.set("scan", report.id)');
    expect(source).toContain('evidence?.kind === "absence"');
    expect(source).toContain("Potential downstream actions");
    expect(source).toContain("RelatedArtifactList title=\"Upstream\"");
    expect(source).toContain("RelatedArtifactList title=\"Downstream\"");
    expect(source).toContain("Relationship");
    expect(source).toContain("Structurally inferred relationship");
  });

  it("keeps prompt, file, and repository analysis on the shared artifact microscope", () => {
    const source = read("src/components/repository-v2/PlaygroundMicroscope.tsx");
    expect(source).toContain("buildArtifactInvestigationViewModel");
    expect(source).toContain("Analyze a prompt");
    expect(source).toContain("Analyze a file");
    expect(source).toContain("Analyze a repository");
    expect(source).toContain("repository-verified execution path is");
    expect(source).toContain("not available in standalone mode");
    expect(source).not.toContain("Prompt analysis UI");
    expect(source).not.toContain("MCP analysis UI");
  });

  it("preserves repository scan context when returning from the microscope", () => {
    const explorer = read("src/components/repository-v2/RepositoryExplorer.tsx");
    const microscope = read("src/components/repository-v2/PlaygroundMicroscope.tsx");
    const shell = read("src/components/repository-v2/PreviewShell.tsx");

    expect(explorer).toContain("const stored = readStoredReport(scanId)");
    expect(explorer).toContain("if (!scanId && stored.id)");
    expect(microscope).toContain("repositoryHref={repositoryBackHref(report)}");
    expect(microscope).toContain('href={repositoryBackHref(report)}');
    expect(shell).toContain('repositoryHref = "/repository-v2"');
  });
});
