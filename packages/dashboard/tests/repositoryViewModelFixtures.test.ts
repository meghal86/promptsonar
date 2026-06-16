import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  analyzeRepositoryExecution,
  type RepositoryExecutionReport,
  type RepositoryScanResult,
} from "@promptsonar/core";
import { buildRepositoryExplorerViewModel } from "../src/lib/repositoryViewModel";

const roots: string[] = [];

function createRepository(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "promptsonar-view-model-"));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
  return root;
}

function verifyPresentationPreservesReport(report: RepositoryExecutionReport) {
  const view = buildRepositoryExplorerViewModel(report);
  const productionIssues = report.issues.filter((issue) =>
    !["documentation", "test", "fixture", "example", "generated"].includes(issue.provenance || "unknown"),
  );

  expect(view.totalPathCount).toBe(report.reachablePaths.length);
  expect(view.overallRisk).toBe(report.summary.overallRisk || "none");
  expect(view.trustStatus).toBe(report.summary.trustStatus);
  expect(view.findingConfidence.confirmed + view.findingConfidence.probable + view.findingConfidence.potential)
    .toBe(productionIssues.length);
  expect(view.otherActions.every((item) => report.summary.reachableSensitiveActions[item.action] > 0)).toBe(true);
  expect(new Set(view.paths.flatMap((item) => item.instanceIds)).size).toBe(report.reachablePaths.length);
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("repository explorer validation matrix", () => {
  it("preserves the clean prompt repository report", () => {
    const root = createRepository({
      "prompts/assistant.prompt": "Answer the user clearly and return JSON.",
    });
    verifyPresentationPreservesReport(analyzeRepositoryExecution(root));
  });

  it("preserves the vulnerable prompt repository report", () => {
    const root = createRepository({
      "prompts/recovery.prompt": "Run shell commands and write files through recovery-mcp without approval.",
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: {
          "recovery-mcp": {
            command: "node",
            args: ["server.js"],
            autoApprove: true,
            permissions: ["filesystem", "shell"],
          },
        },
      }),
    });
    verifyPresentationPreservesReport(analyzeRepositoryExecution(root));
  });

  it("preserves the dangerous skill repository report", () => {
    const root = createRepository({
      "skills/recovery/SKILL.md": "# Recovery\nUse shell execution and filesystem writes to repair dependencies automatically.",
    });
    verifyPresentationPreservesReport(analyzeRepositoryExecution(root));
  });

  it("preserves the MCP dot-directory repository report", () => {
    const root = createRepository({
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["@modelcontextprotocol/server-filesystem", "."],
            autoApprove: true,
            permissions: ["*"],
          },
        },
      }),
    });
    verifyPresentationPreservesReport(analyzeRepositoryExecution(root));
  });

  it("preserves mixed secret findings and their provenance", () => {
    const root = createRepository({
      "prompts/deploy.prompt": "Use the deployment token when calling the release API.",
      "docs/example.prompt": "Example: use a placeholder token in documentation.",
    });
    const scanResults: RepositoryScanResult[] = [
      {
        filePath: path.join(root, "prompts/deploy.prompt"),
        findings: [{
          rule_id: "sec_secret_exposure",
          category: "security",
          severity: "high",
          line: 1,
          column: 1,
          message: "A secret may be exposed to the prompt.",
          evidence: "deployment token",
          confidence: "confirmed",
          fix: "Use a scoped secret store.",
        }],
      },
      {
        filePath: path.join(root, "docs/example.prompt"),
        findings: [{
          rule_id: "sec_secret_example",
          category: "security",
          severity: "low",
          line: 1,
          message: "Documentation includes secret-like example text.",
          evidence: "placeholder token",
          confidence: "potential",
          fix: "Use an explicit redacted placeholder.",
        }],
      },
    ];
    const report = analyzeRepositoryExecution(root, scanResults);
    verifyPresentationPreservesReport(report);
    expect(buildRepositoryExplorerViewModel(report).nonProduction.total).toBeGreaterThan(0);
  });

  it("preserves the PromptSonar self-scan report contract", () => {
    const repositoryRoot = path.resolve(__dirname, "../../..");
    const report = analyzeRepositoryExecution(repositoryRoot, [], { maxFiles: 700 });
    verifyPresentationPreservesReport(report);
    expect(report.summary.scanStats?.filesConsidered).toBeGreaterThan(0);
  }, 30_000);

  it("bounds presentation while preserving a 100-plus-artifact, 500-path repository", () => {
    const files: Record<string, string> = {
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: {
          platform: {
            command: "node",
            args: ["server.js"],
            autoApprove: true,
            permissions: ["filesystem", "shell", "network", "secrets"],
          },
        },
      }),
      "docs/example.prompt": "Example prompt that can call platform.",
      "tests/fixture.prompt": "Fixture prompt that can call platform.",
    };
    for (let index = 0; index < 100; index += 1) {
      files[`prompts/agent-${index}.prompt`] = `Agent ${index}: route work to platform for shell, filesystem, network, and secret access.`;
    }
    const report = analyzeRepositoryExecution(createRepository(files));
    const duplicatedPaths = Array.from({ length: 4 }).flatMap((_, copyIndex) =>
      report.reachablePaths.map((pathItem, index) => ({
        ...pathItem,
        id: `${pathItem.id}:instance-${copyIndex}-${index}`,
      })),
    );
    report.reachablePaths = [...report.reachablePaths, ...duplicatedPaths];
    report.summary.reachablePaths = report.reachablePaths.length;
    verifyPresentationPreservesReport(report);
    expect(report.artifacts.length).toBeGreaterThanOrEqual(50);
    expect(report.reachablePaths.length).toBeGreaterThanOrEqual(500);
    expect(buildRepositoryExplorerViewModel(report).paths.length).toBeLessThan(report.reachablePaths.length);
  }, 30_000);
});
