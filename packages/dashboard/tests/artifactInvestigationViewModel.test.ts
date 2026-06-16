import { describe, expect, it } from "vitest";
import type { RepositoryExecutionReport } from "@promptsonar/core";
import {
  buildArtifactInvestigationViewModel,
  buildSingleFileInvestigationViewModel,
  buildSinglePromptInvestigationViewModel,
  type ArtifactKind,
} from "../src/lib/repositoryViewModel";

const artifactCases: Array<{ kind: ArtifactKind; type: string; file: string; nodeType: string }> = [
  { kind: "prompt", type: "PROMPT", file: "prompts/reviewer.prompt", nodeType: "PROMPT" },
  { kind: "agent", type: "AGENT_CONFIG", file: "agents/reviewer-agent.md", nodeType: "PROMPT" },
  { kind: "mcp", type: "MCP_SERVER", file: ".cursor/mcp.json", nodeType: "MCP_SERVER" },
  { kind: "skill", type: "SKILL", file: "skills/release/SKILL.md", nodeType: "SKILL" },
  { kind: "workflow", type: "WORKFLOW", file: ".github/workflows/ai-review.yml", nodeType: "WORKFLOW" },
  { kind: "memory", type: "MEMORY", file: "memory/reviewer-memory.json", nodeType: "MEMORY" },
  { kind: "tool", type: "TOOL", file: "tools/tool-router.yaml", nodeType: "TOOL" },
];

function reportForArtifact(item: typeof artifactCases[number], repository = true): RepositoryExecutionReport {
  return {
    id: `report-${item.kind}`,
    version: "1",
    generated_at: "2026-06-16T00:00:00.000Z",
    repository: { root: repository ? "/repo" : "/playground", name: repository ? "fixture" : "single input" },
    scanMode: "browser-bounded",
    artifacts: [{
      id: `artifact-${item.kind}`,
      type: item.type as any,
      name: item.file.split("/").pop() || item.file,
      filePath: `/repo/${item.file}`,
      relativePath: item.file,
      description: `${item.kind} artifact`,
      evidence: ["declared artifact"],
      provenance: "production",
      signals: [item.kind],
    }],
    executionMap: {
      nodes: [
        { id: `node-${item.kind}`, type: item.nodeType as any, label: item.file, relativePath: item.file, artifactId: `artifact-${item.kind}`, description: "" },
        { id: "node-action", type: "ACTION", label: "Filesystem write", description: "", metadata: { sensitiveAction: "Filesystem" } },
      ],
      edges: repository ? [{
        id: "edge-action",
        from: `node-${item.kind}`,
        to: "node-action",
        type: "CAN_REACH",
        reason: "Artifact declares filesystem capability.",
        evidence: "filesystem",
        confidence: 72,
        confidenceLabel: "Probable",
        provenance: "connected",
      } as any] : [],
      paths: [],
    },
    reachablePaths: repository ? [{
      id: "path-action",
      risk: "high",
      nodeIds: [`node-${item.kind}`, "node-action"],
      edgeIds: ["edge-action"],
      sensitiveActions: ["Filesystem"],
      sensitiveAction: "Filesystem",
      sourceNodeId: `node-${item.kind}`,
      sinkNodeId: "node-action",
      evidence: [{ filePath: item.file, message: "Filesystem capability", ruleId: "sec_access", line: 1 }],
      files: [item.file],
      provenance: "production",
      confidence: 72,
      confidenceLevel: "probable",
      confidenceLabel: "Probable",
      explanation: "The artifact can reach filesystem write.",
      findings: [],
    } as any] : [],
    summary: {
      filesScanned: 1,
      aiSurfacesFound: { prompts: 0, skills: 0, mcpServers: 0, tools: 0, workflows: 0, memorySystems: 0, agentConfigs: 0 },
      executionGraph: { nodes: repository ? 2 : 1, edges: repository ? 1 : 0 },
      reachableSensitiveActions: { Shell: 0, Filesystem: repository ? 1 : 0, Network: 0, Secrets: 0, "External APIs": 0 },
      riskSummary: { critical: 0, high: repository ? 1 : 0, medium: 0, low: repository ? 0 : 1 },
      confidenceSummary: { confirmed: 0, probable: repository ? 1 : 0, potential: repository ? 0 : 1 },
      overallRisk: repository ? "high" : "low",
      trustStatus: repository ? "High Risk" : "Review Required",
    } as any,
    issues: [{
      id: `issue-${item.kind}`,
      ruleId: "bp_missing_cot",
      severity: "low",
      category: "quality",
      issue: "The instruction does not define reviewable decision criteria.",
      impact: "The artifact may skip required checks.",
      whyThisMatters: "The selected finding only proves missing verification guidance.",
      howToFix: "Require input validation, constraint checks, final-output verification, and a concise verification summary.",
      fix: {
        quickFix: "Require verification for a multi-step task.",
        recommendedFix: "Add required input validation, intermediate checks, final format verification, and unresolved-assumption reporting.",
        safePattern: "Before returning the result:\n1. Validate required inputs.\n2. Check intermediate results against constraints.\n3. Verify the final output format.",
        effort: "Quick",
      },
      evidence: [{
        id: `evidence-${item.kind}`,
        file: item.file,
        kind: "absence",
        startLine: 1,
        endLine: 8,
        snippet: "",
        scopeLabel: "Instruction block",
        missingRequirement: "No verification requirement was found within that block.",
        source: "scanner",
      }],
      confidence: { score: 70, level: "probable", label: "Probable", definition: "Evidence inferred from connected relationships." },
      technicalDetails: { executionPath: "", evidence: [], confidence: { score: 70, level: "probable", label: "Probable", definition: "Evidence inferred from connected relationships." } },
      impactedFiles: [item.file],
      fixSuggestions: [],
      pathIds: repository ? ["path-action"] : [],
      provenance: "production",
    } as any],
    issueSummary: { total: 1, critical: 0, high: 0, medium: 0, low: 1 },
    impactedFiles: [{ path: item.file, name: item.file.split("/").pop() || item.file, type: item.kind, issueIds: [`issue-${item.kind}`], issueCount: 1, highestSeverity: "low", pathIds: repository ? ["path-action"] : [] }],
    pathValidation: { valid: true, checkedPaths: repository ? 1 : 0, errors: [] },
    confidenceDefinitions: {
      confirmed: "Direct evidence exists.",
      probable: "Evidence inferred from connected relationships.",
      potential: "Structural inference only.",
    },
    findings: [],
    exports: { json: true, sarif: true, html: true, mapJson: true },
  } as RepositoryExecutionReport;
}

describe("artifact investigation view model", () => {
  it.each(artifactCases)("uses the shared microscope model for $kind artifacts", (item) => {
    const report = reportForArtifact(item);
    const view = buildArtifactInvestigationViewModel({
      report,
      source: "repository",
      artifactId: `artifact-${item.kind}`,
      filePath: item.file,
      issueId: `issue-${item.kind}`,
    });

    expect(view.artifact.kind).toBe(item.kind);
    expect(view.selectedFinding?.id).toBe(`issue-${item.kind}`);
    expect(view.evidence[0]).toMatchObject({ kind: "absence", issueId: `issue-${item.kind}` });
    expect(view.remediation?.safePattern).toContain("Validate required inputs");
    expect(view.countMetadata.findings.total).toBe(1);
    expect(view.linkedPathFamilies[0].instanceCount).toBe(1);
    expect(view.sensitiveActions[0]).toMatchObject({ action: "Filesystem", supportingPathId: "path-action" });
  });

  it("does not fabricate repository wiring for standalone prompt or file scans", () => {
    const promptReport = reportForArtifact(artifactCases[0], false);
    const promptView = buildSinglePromptInvestigationViewModel(promptReport, "issue-prompt");
    expect(promptView.source).toBe("single-input");
    expect(promptView.repositoryWiringAvailable).toBe(false);
    expect(promptView.linkedPathFamilies).toEqual([]);
    expect(promptView.otherPathFamilies).toEqual([]);
    expect(promptView.sensitiveActions).toEqual([]);

    const fileReport = reportForArtifact(artifactCases[3], false);
    const fileView = buildSingleFileInvestigationViewModel(fileReport, "skills/release/SKILL.md", "issue-skill");
    expect(fileView.artifact.kind).toBe("skill");
    expect(fileView.repositoryWiringAvailable).toBe(false);
    expect(fileView.upstream).toEqual([]);
    expect(fileView.downstream).toEqual([]);
  });
});
