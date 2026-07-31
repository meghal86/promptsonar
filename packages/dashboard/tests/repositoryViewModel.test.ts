import { describe, expect, it } from "vitest";
import type { RepositoryExecutionReport } from "@promptsonar/core";
import {
  buildPlaygroundMicroscopeViewModel,
  buildRepositoryExplorerViewModel,
  formatDistinctPathLabel,
  formatRepositoryRelativePath,
  getActionGraphProjection,
  getClusteredArchitectureProjection,
  getCountMetadata,
  getFileGraphProjection,
  getHighestRiskPathProjection,
  getIssueGraphProjection,
  validateIssuePresentation,
} from "../src/lib/repositoryViewModel";

const report = {
  id: "report-1",
  version: "1",
  generated_at: "2026-06-14T00:00:00.000Z",
  repository: { root: "/repo", name: "fixture" },
  scanMode: "browser-bounded",
  artifacts: [
    { id: "a-prompt", type: "PROMPT", name: "review", filePath: "/repo/review.prompt", relativePath: "review.prompt", description: "", evidence: [], provenance: "production", signals: [] },
    { id: "a-mcp", type: "MCP_SERVER", name: "filesystem", filePath: "/repo/.cursor/mcp.json", relativePath: ".cursor/mcp.json", description: "", evidence: [], provenance: "production", signals: [] },
  ],
  executionMap: {
    nodes: [
      { id: "n-prompt", type: "PROMPT", label: "review.prompt", relativePath: "review.prompt", description: "" },
      { id: "n-mcp", type: "MCP_SERVER", label: "filesystem-mcp", relativePath: ".cursor/mcp.json", description: "" },
      { id: "n-action", type: "ACTION", label: "Filesystem write", description: "", metadata: { sensitiveAction: "Filesystem" } },
    ],
    edges: [
      { id: "e-route", from: "n-prompt", to: "n-mcp", type: "ROUTES_TO", reason: "Prompt names the MCP server.", confidence: 78, confidenceLabel: "Probable" },
      { id: "e-write", from: "n-mcp", to: "n-action", type: "CAN_REACH", reason: "Wildcard filesystem permission is declared.", confidence: 95, confidenceLabel: "Confirmed" },
    ],
    paths: [],
  },
  reachablePaths: [
    {
      id: "path-high",
      risk: "high",
      nodeIds: ["n-prompt", "n-mcp", "n-action"],
      edgeIds: ["e-route", "e-write"],
      sensitiveActions: ["Filesystem"],
      sensitiveAction: "Filesystem",
      sourceNodeId: "n-prompt",
      sinkNodeId: "n-action",
      evidence: [],
      files: ["/repo/review.prompt", "/repo/.cursor/mcp.json"],
      provenance: "production",
      confidence: 78,
      confidenceLevel: "probable",
      confidenceLabel: "Probable",
      confidenceDefinition: "Evidence inferred from connected relationships.",
      explanation: "The prompt may reach filesystem write.",
      findings: [],
    },
  ],
  summary: {
    filesScanned: 2,
    scanStats: { filesConsidered: 3, filesScanned: 2, filesSkipped: 1, skipReasons: { unsupported: 1 }, truncated: false },
    overallRisk: "high",
    aiSurfacesFound: { prompts: 1, skills: 0, mcpServers: 1, tools: 0, workflows: 0, memorySystems: 0, agentConfigs: 0 },
    executionGraph: { nodes: 3, edges: 2 },
    reachableSensitiveActions: { Shell: 0, Filesystem: 1, Network: 0, Secrets: 0, "External APIs": 0 },
    riskSummary: { critical: 0, high: 1, medium: 0, low: 0 },
    confidenceSummary: { confirmed: 0, probable: 1, potential: 0 },
    trustStatus: "High Risk",
  },
  issues: [
    {
      id: "issue-1",
      ruleId: "mcp_wildcard",
      severity: "high",
      category: "security",
      context: { verdict: "risky_configuration" },
      issue: "Wildcard filesystem permission",
      impact: "The MCP server can write outside an approved scope.",
      whyThisMatters: "A reachable tool can modify files.",
      howToFix: "Restrict the permission.",
      fix: { quickFix: "Remove the wildcard.", recommendedFix: "Allowlist a read-only directory.", safePattern: "permissions: [filesystem.read]", effort: "Quick" },
      evidence: [{ id: "ev-1", file: ".cursor/mcp.json", line: 9, column: 3, snippet: "\"permissions\": [\"*\"]", source: "scanner" }],
      confidence: { score: 98, level: "confirmed", label: "Confirmed", definition: "Direct evidence exists." },
      technicalDetails: { executionPath: "", evidence: [], confidence: { score: 98, level: "confirmed", label: "Confirmed", definition: "Direct evidence exists." } },
      impactedFiles: ["/repo/.cursor/mcp.json"],
      fixSuggestions: [],
      pathIds: ["path-high"],
      provenance: "production",
    },
    {
      id: "issue-doc",
      ruleId: "doc-example",
      severity: "low",
      category: "quality",
      issue: "Example only",
      impact: "Example text.",
      whyThisMatters: "Example text.",
      howToFix: "Clarify it.",
      fix: { quickFix: "Clarify it.", recommendedFix: "Clarify it.", safePattern: "example", effort: "Quick" },
      evidence: [],
      confidence: { score: 60, level: "potential", label: "Potential", definition: "Structural inference only." },
      technicalDetails: { executionPath: "", evidence: [], confidence: { score: 60, level: "potential", label: "Potential", definition: "Structural inference only." } },
      impactedFiles: ["/repo/docs/example.md"],
      fixSuggestions: [],
      pathIds: [],
      provenance: "documentation",
    },
  ],
  issueSummary: { total: 2, critical: 0, high: 1, medium: 0, low: 1 },
  impactedFiles: [
    { path: ".cursor/mcp.json", name: "mcp.json", type: "MCP Config", issueIds: ["issue-1"], issueCount: 1, highestSeverity: "high", pathIds: ["path-high"] },
  ],
  pathValidation: { valid: true, checkedPaths: 1, errors: [] },
  confidenceDefinitions: {
    confirmed: "Direct evidence exists.",
    probable: "Evidence inferred from connected relationships.",
    potential: "Structural inference only.",
  },
  findings: [],
  exports: { json: true, sarif: true, html: true, mapJson: true },
} as unknown as RepositoryExecutionReport;

describe("repository explorer view models", () => {
  it("projects the highest path without upgrading its weakest-edge confidence", () => {
    const path = getHighestRiskPathProjection(report);
    expect(path?.confidenceLabel).toBe("Probable");
    expect(path?.confirmedFacts).toEqual(["Wildcard filesystem permission is declared."]);
    expect(path?.inferredRelationships).toEqual(["Prompt names the MCP server."]);
  });

  it("builds file, issue, and action graph projections from canonical nodes and edges", () => {
    expect(getFileGraphProjection(report, ".cursor/mcp.json").nodes.map((node) => node.id)).toEqual([
      "n-prompt",
      "n-mcp",
      "n-action",
    ]);
    expect(getIssueGraphProjection(report, "issue-1").edges).toHaveLength(2);
    expect(getActionGraphProjection(report, "Filesystem").relatedPaths[0].id).toBe("path-high");
  });

  it("groups the architecture without inventing nodes", () => {
    const clusters = getClusteredArchitectureProjection(report);
    expect(clusters.reduce((total, cluster) => total + cluster.count, 0)).toBe(report.executionMap.nodes.length);
  });

  it("keeps file finding severity separate from path risk and isolates non-production issues", () => {
    const view = buildRepositoryExplorerViewModel(report);
    expect(view.files[0].fileFindingSeverity).toBe("high");
    expect(view.files[0].highestPathRisk).toBe("high");
    expect(view.findingConfidence).toEqual({ confirmed: 1, probable: 0, potential: 0 });
    expect(view.nonProduction.total).toBe(1);
    expect(view.nonProduction.affectsVerdict).toBe(false);
    expect(view.totalPathCount).toBe(1);
  });

  it("builds the microscope around the selected file with exact evidence and canonical fix data", () => {
    const view = buildPlaygroundMicroscopeViewModel({
      report,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
    });
    expect(view.selectedFile).toBe(".cursor/mcp.json");
    expect(view.issue?.confidence.label).toBe("Confirmed");
    expect(view.issue?.contextualVerdictLabel).toBe("Risky configuration");
    expect(view.evidence[0]).toMatchObject({ line: 9, column: 3, snippet: "\"permissions\": [\"*\"]" });
    expect(view.fix?.effort).toBe("Quick");
    expect(view.highestRelatedPathRisk).toBe("high");
    expect(view.issueCount).toBe(1);
    expect(view.issues.map((issue) => issue.id)).toEqual(["issue-1"]);
  });

  it("validates that issue presentation evidence and remediation belong to the selected issue", () => {
    const view = buildPlaygroundMicroscopeViewModel({
      report,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
    });
    expect(() => validateIssuePresentation(view.issue!)).not.toThrow();
    expect(() => validateIssuePresentation({
      ...view.issue!,
      fix: { ...view.issue!.fix, recommendationRuleId: "other-rule" },
    })).toThrow(/Recommendation rule ID/);
    expect(() => validateIssuePresentation({
      ...view.issue!,
      evidence: [{ ...view.issue!.evidence[0], issueId: "other-issue" }],
    })).toThrow(/references issue/);
    expect(() => validateIssuePresentation({
      ...view.issue!,
      evidence: [{ ...view.issue!.evidence[0], filePath: "other/file.prompt" }],
    })).toThrow(/not part of issue/);
  });

  it("renders absence evidence as a scoped missing requirement, not an exact source line", () => {
    const absenceReport = structuredClone(report);
    absenceReport.issues[0] = {
      ...absenceReport.issues[0],
      id: "issue-absence",
      ruleId: "bp_missing_cot",
      severity: "low",
      issue: "The instruction does not define reviewable decision criteria for a complex task.",
      impact: "The model may skip required checks.",
      fix: {
        quickFix: "Require verification for a multi-step task.",
        recommendedFix: "Add required input validation, intermediate checks, final format verification, and unresolved-assumption reporting.",
        safePattern: "Before returning the result:\n1. Validate required inputs.\n2. Check intermediate results against constraints.\n3. Verify the final output format.",
        effort: "Quick",
      },
      evidence: [{
        id: "ev-absence",
        file: "review.prompt",
        kind: "absence",
        startLine: 4,
        endLine: 12,
        snippet: "",
        scopeLabel: "Instruction block",
        missingRequirement: "No verification requirement was found within that block.",
        source: "scanner",
      }],
      impactedFiles: ["review.prompt"],
      pathIds: [],
    };
    absenceReport.impactedFiles = [
      { path: "review.prompt", name: "review.prompt", type: "Prompt", issueIds: ["issue-absence"], issueCount: 1, highestSeverity: "low", pathIds: [] },
    ];

    const view = buildPlaygroundMicroscopeViewModel({
      report: absenceReport,
      filePath: "review.prompt",
      issueId: "issue-absence",
    });

    expect(view.evidence[0]).toMatchObject({
      kind: "absence",
      filePath: "review.prompt",
      startLine: 4,
      endLine: 12,
      missingRequirement: "No verification requirement was found within that block.",
    });
    expect(view.evidence[0]).not.toHaveProperty("snippet", "from __future__ import annotations");
  });

  it("returns every issue attached to a file and preserves the selected issue", () => {
    const reportWithTwoIssues = structuredClone(report);
    reportWithTwoIssues.issues.push({
      ...structuredClone(reportWithTwoIssues.issues[0]),
      id: "issue-2",
      ruleId: "quality-check",
      severity: "medium",
      issue: "Output contract is unclear",
      confidence: {
        score: 82,
        level: "probable",
        label: "Probable",
        definition: "Evidence inferred from connected relationships.",
      },
    });
    reportWithTwoIssues.impactedFiles[0].issueIds.push("issue-2");
    reportWithTwoIssues.impactedFiles[0].issueCount = 2;

    const view = buildPlaygroundMicroscopeViewModel({
      report: reportWithTwoIssues,
      filePath: ".cursor/mcp.json",
      issueId: "issue-2",
    });

    expect(view.issueCount).toBe(2);
    expect(view.issues.map((issue) => issue.id)).toEqual(["issue-1", "issue-2"]);
    expect(view.issue?.id).toBe("issue-2");
  });

  it("falls back to file-related paths when an issue has no direct path ids", () => {
    const reportWithoutIssuePaths = structuredClone(report);
    reportWithoutIssuePaths.issues[0].pathIds = [];
    const view = buildPlaygroundMicroscopeViewModel({
      report: reportWithoutIssuePaths,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
    });
    expect(view.relatedPaths.map((path) => path.id)).toEqual(["path-high"]);
    expect(view.pathsSupportedByIssue).toEqual([]);
    expect(view.otherPathsInvolvingFile.map((path) => path.id)).toEqual(["path-high"]);
  });

  it("shows every file-related route when a file link also includes a finding", () => {
    const reportWithAnotherFilePath = structuredClone(report);
    reportWithAnotherFilePath.executionMap.nodes.push({
      id: "n-secondary-prompt",
      type: "PROMPT",
      label: "secondary.prompt",
      relativePath: "secondary.prompt",
      description: "",
    });
    reportWithAnotherFilePath.executionMap.edges.push({
      id: "e-secondary-route",
      from: "n-secondary-prompt",
      to: "n-mcp",
      type: "ROUTES_TO",
      reason: "A second prompt names the same MCP server.",
      confidence: 72,
      confidenceLabel: "Probable",
    });
    reportWithAnotherFilePath.reachablePaths.push({
      ...structuredClone(report.reachablePaths[0]),
      id: "path-secondary",
      nodeIds: ["n-secondary-prompt", "n-mcp", "n-action"],
      edgeIds: ["e-secondary-route", "e-write"],
      sourceNodeId: "n-secondary-prompt",
      files: ["/repo/secondary.prompt", "/repo/.cursor/mcp.json"],
      confidence: 72,
      explanation: "The second prompt may reach filesystem write.",
    });

    const view = buildPlaygroundMicroscopeViewModel({
      report: reportWithAnotherFilePath,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
    });

    expect(view.relatedPaths.map((path) => path.id)).toEqual(["path-high", "path-secondary"]);
    expect(view.pathsSupportedByIssue.map((path) => path.id)).toEqual(["path-high"]);
    expect(view.otherPathsInvolvingFile.map((path) => path.id)).toEqual(["path-secondary"]);
  });

  it("formats repository-relative paths and disambiguates duplicate basenames", () => {
    expect(formatRepositoryRelativePath(
      "/Users/me/project/AgentSabha/.claude/worktrees/amazing-tharp/backend/app/agents/clustering.py",
      "/Users/me/project/AgentSabha",
    )).toBe("backend/app/agents/clustering.py");
    expect(formatDistinctPathLabel("tasks/clustering.py", ["tasks/clustering.py", "agents/clustering.py"])).toBe("tasks/clustering.py");
    expect(formatDistinctPathLabel("agents/clustering.py", ["tasks/clustering.py", "agents/clustering.py"])).toBe("agents/clustering.py");
  });

  it("keeps count metadata internally consistent", () => {
    expect(getCountMetadata(6, 5)).toEqual({ total: 6, visible: 5, hidden: 1 });
    const view = buildRepositoryExplorerViewModel(report);
    expect(view.pathCount.total).toBe(report.reachablePaths.length);
    expect(view.pathCount.visible).toBe(view.paths.length);
    expect(view.pathCount.hidden).toBe(view.pathCount.total - view.pathCount.visible);
  });

  it("groups duplicate path families and preserves route instance counts", () => {
    const groupedReport = structuredClone(report);
    groupedReport.executionMap.nodes.push(
      { id: "n-prompt-2", type: "PROMPT", label: "review-copy.prompt", relativePath: "review-copy.prompt", description: "" },
    );
    groupedReport.executionMap.edges.push(
      { id: "e-route-2", from: "n-prompt-2", to: "n-mcp", type: "ROUTES_TO", reason: "A second prompt names the MCP server.", confidence: 78, confidenceLabel: "Probable" },
    );
    groupedReport.reachablePaths.push({
      ...structuredClone(report.reachablePaths[0]),
      id: "path-high-copy",
      nodeIds: ["n-prompt-2", "n-mcp", "n-action"],
      edgeIds: ["e-route-2", "e-write"],
      sourceNodeId: "n-prompt-2",
      files: ["/repo/review-copy.prompt", "/repo/.cursor/mcp.json"],
    });
    const view = buildRepositoryExplorerViewModel(groupedReport);
    const grouped = view.paths.find((path) => path.instanceIds.includes("path-high") && path.instanceIds.includes("path-high-copy"));
    expect(grouped?.instanceCount).toBe(2);
    expect(view.pathCount.total).toBe(2);
    expect(view.pathCount.visible).toBe(1);
  });

  it("does not render sensitive actions that lack a corresponding canonical path sink", () => {
    const actionReport = structuredClone(report);
    actionReport.reachablePaths[0].sensitiveActions = ["Filesystem", "Secrets"];
    actionReport.summary.reachableSensitiveActions.Secrets = 1;
    const path = getHighestRiskPathProjection(actionReport);
    expect(path?.action).toBe("Filesystem");
    expect(buildRepositoryExplorerViewModel(actionReport).otherActions.map((item) => item.action)).not.toContain("Secrets");
  });

  it("exposes graph-edge evidence or structural fallback for every visible edge", () => {
    const view = buildPlaygroundMicroscopeViewModel({
      report,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
    });
    expect(view.graph.edgePresentations.every((edge) => edge.relationship && edge.evidence && edge.confidenceLabel)).toBe(true);
  });

  it("keeps only the clicked file selected when narrowing to one path", () => {
    const view = buildPlaygroundMicroscopeViewModel({
      report,
      filePath: ".cursor/mcp.json",
      issueId: "issue-1",
      pathId: "path-high",
    });

    expect(view.relatedPaths.map((path) => path.id)).toEqual(["path-high"]);
    expect(view.graph.selectedNodeIds).toEqual(["n-mcp"]);
  });

  it("falls back safely when deep-linked file or issue ids are invalid", () => {
    const view = buildPlaygroundMicroscopeViewModel({
      report,
      filePath: "missing/path.prompt",
      issueId: "missing-issue",
      pathId: "missing-path",
    });

    expect(view.selectedFile).toBe(".cursor/mcp.json");
    expect(view.issue?.id).toBe("issue-1");
  });
});
