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
    expect(source).toContain("aria-disabled=\"true\"");
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
    expect(source).toContain("aria-current");
    expect(source).toContain("ArrowDown");
    expect(source).toContain("File-level absence finding");
    expect(source).toContain("Independent execution paths involving this file");
    expect(source).toContain("Relationship");
    expect(source).toContain("Structurally inferred relationship");
  });
});
