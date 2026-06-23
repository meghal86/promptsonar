import { describe, expect, it } from "vitest";
import {
  MAX_BROWSER_TOTAL_CHARS,
  buildRepositoryPayload,
  prepareRepositorySelection,
  stripCommonRepositoryRoot,
} from "../src/lib/repositorySelection";

function mockFile(relativePath: string, type = "", size = 100): File {
  const content = "x".repeat(size);
  return {
    name: relativePath.split("/").pop() || relativePath,
    type,
    size,
    webkitRelativePath: relativePath,
    slice: (_start?: number, end?: number) => ({
      text: async () => content.slice(0, end),
    }),
  } as File & { webkitRelativePath: string };
}

describe("repository folder selection", () => {
  it("preserves the full folder count while bounding the browser scan queue", () => {
    const files = [
      ...Array.from({ length: 34_600 }, (_, index) => mockFile(`src/file-${index}.ts`, "text/typescript")),
      ...Array.from({ length: 50 }, (_, index) => mockFile(`assets/image-${index}.png`, "image/png")),
      ...Array.from({ length: 15 }, (_, index) => mockFile(`node_modules/pkg-${index}/index.ts`, "text/typescript")),
    ];

    const selection = prepareRepositorySelection(files);

    expect(selection.stats).toEqual({
      total: 34_665,
      eligible: 34_600,
      queued: 200,
      excludedByFileLimit: 34_400,
      excludedByPayloadLimit: 0,
      estimatedChars: 20_000,
    });
    expect(selection.files).toHaveLength(200);
  });

  it("uses bounded slices and stops the payload at the browser content limit", async () => {
    const files = Array.from(
      { length: 700 },
      (_, index) => mockFile(`src/large-${index}.ts`, "text/typescript", 100_000),
    );
    const selection = prepareRepositorySelection(files);
    const progress: number[] = [];
    const payload = await buildRepositoryPayload(selection.files, (completed) => progress.push(completed));

    expect(selection.stats.queued).toBe(50);
    expect(selection.stats.excludedByFileLimit).toBe(500);
    expect(selection.stats.excludedByPayloadLimit).toBe(150);
    expect(payload.totalChars).toBe(MAX_BROWSER_TOTAL_CHARS);
    expect(payload.files).toHaveLength(50);
    expect(progress.at(-1)).toBe(50);
  });

  it("strips the selected folder name so uploads use repo-relative paths like GitHub", async () => {
    const files = [
      mockFile("PromptSonar/CLAUDE.md", "text/markdown", 120),
      mockFile("PromptSonar/packages/core/src/index.ts", "text/typescript", 120),
      mockFile("PromptSonar/docs/example.prompt", "text/plain", 120),
    ];

    const selection = prepareRepositorySelection(files);
    const payload = await buildRepositoryPayload(selection.files);

    expect(payload.files.map(file => file.path)).toEqual([
      "docs/example.prompt",
      "CLAUDE.md",
      "packages/core/src/index.ts",
    ]);
    expect(payload.files.every(file => !file.path.startsWith("PromptSonar/"))).toBe(true);
  });

  it("does not strip paths when there is no common selected folder root", () => {
    const stripped = stripCommonRepositoryRoot(["repo-a/CLAUDE.md", "repo-b/CLAUDE.md", "README.md"]);

    expect(stripped.get("repo-a/CLAUDE.md")).toBe("repo-a/CLAUDE.md");
    expect(stripped.get("repo-b/CLAUDE.md")).toBe("repo-b/CLAUDE.md");
    expect(stripped.get("README.md")).toBe("README.md");
  });
});
