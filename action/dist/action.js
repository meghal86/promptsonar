"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/action.ts
var core = __toESM(require("@actions/core"));
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_core2 = require("@promptsonar/core");

// src/scanner-bridge.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_fast_glob = __toESM(require("fast-glob"));
var import_core = require("@promptsonar/core");
var import_sarif = require("@promptsonar/core/dist/formatter/sarif");
function getOwaspRef(ruleId) {
  if (ruleId.startsWith("sec_owasp_llm01") || ruleId.startsWith("sec_unicode") || ruleId === "sec_unbounded_persona" || ruleId === "sec_base64_encoded_payload" || ruleId === "sec_homoglyph_evasion" || ruleId === "sec_zero_width_injection") return "LLM01";
  if (ruleId.startsWith("sec_owasp_llm02")) return "LLM02";
  if (ruleId === "sec_unbounded_access" || ruleId === "sec_rag_injection") return "LLM07";
  return "";
}
function getConfidenceForFinding(ruleId, severity) {
  if (severity === "critical") return "VERY_HIGH";
  if (ruleId === "sec_base64_encoded_payload" || ruleId === "sec_zero_width_injection" || ruleId === "sec_homoglyph_evasion" || ruleId.startsWith("sec_owasp_llm02") || ruleId.startsWith("MCP-")) return "HIGH";
  if (severity === "high" || severity === "medium") return "MEDIUM";
  return "LOW";
}
function getRuleDocsUrl(ruleId) {
  return `https://github.com/meghal86/promptsonar/blob/main/docs/rules.md#${ruleId.toLowerCase()}`;
}
function getDeterministicRecommendation(ruleId, fallback) {
  if (ruleId === "sec_owasp_llm01_injection") return "Treat user-provided text as untrusted content. Place it in a clearly delimited data block and state that it cannot modify system instructions.";
  if (ruleId === "sec_zero_width_injection") return "Normalize prompt strings before scanning and remove U+200B, U+200C, U+200D, and U+FEFF characters.";
  if (ruleId === "sec_homoglyph_evasion") return "Reject or normalize non-Latin homoglyph characters in prompt strings unless the language requirement is explicit.";
  if (ruleId === "sec_base64_encoded_payload") return "Do not embed encoded instructions in prompt strings. Decode, review, and store only plain-text approved instructions.";
  if (ruleId.startsWith("sec_owasp_llm02")) return "Move secrets to environment variables or a secret manager, rotate exposed credentials, and keep only placeholders in prompt templates.";
  if (ruleId === "sec_unbounded_access") return "Scope tools to the minimum required paths, commands, tables, or APIs. Deny shell/filesystem access unless explicitly needed.";
  if (ruleId === "sec_rag_injection") return "Validate and sanitize retrieval queries before use. Pass only a validated_query object into retrieval code.";
  return fallback || "Review the prompt and apply the documented safer pattern.";
}
function getRiskExplanation(ruleId) {
  if (ruleId === "sec_owasp_llm01_injection") return "User-controlled text may override system instructions, extract hidden prompts, or bypass intended safety boundaries.";
  if (ruleId === "sec_zero_width_injection") return "Invisible Unicode can hide jailbreak text from reviewers while changing what the model or scanner sees.";
  if (ruleId === "sec_homoglyph_evasion") return "Lookalike Unicode characters can bypass ASCII-only filters and conceal malicious instructions.";
  if (ruleId === "sec_base64_encoded_payload") return "Encoded instructions can smuggle jailbreak payloads through review and validation layers.";
  if (ruleId.startsWith("sec_owasp_llm02")) return "Secrets or sensitive data in prompt text can leak through logs, responses, screenshots, or repository history.";
  if (ruleId === "sec_unbounded_access") return "Over-broad tool or data access gives an agent more authority than the task requires.";
  if (ruleId === "sec_rag_injection") return "Raw retrieval queries can let untrusted content steer context selection or poison model inputs.";
  if (ruleId === "sec_unbounded_persona") return "Unbounded role-play prompts can weaken instruction hierarchy and make policy bypass easier.";
  if (ruleId.startsWith("MCP-")) return "MCP configuration may expose tools, credentials, or execution capability beyond the agent workflow trust boundary.";
  return "This pattern weakens prompt reliability, auditability, or downstream safety controls.";
}
function lineLooksRelevant(line, ruleId) {
  const lower = line.toLowerCase();
  if (ruleId.includes("llm01") || ruleId.includes("injection")) return /ignore|disregard|forget|dan|developer mode|system prompt|previous instructions|jailbreak|bypass/.test(lower);
  if (ruleId.includes("pii")) return /sk-|api[_ -]?key|secret|token|password|bearer|ssn|credit card|\d{3}-\d{2}-\d{4}/.test(lower);
  if (ruleId.includes("zero_width")) return /[\u200B-\u200D\uFEFF]/.test(line);
  if (ruleId.includes("homoglyph") || ruleId.includes("unicode")) return /[^\x00-\x7F]/.test(line);
  if (ruleId.includes("unbounded_access")) return /all files|any file|entire|admin|root|shell|network|database|db/.test(lower);
  if (ruleId.includes("rag")) return /user_input|raw user|retrieval|search|query|context/.test(lower);
  return false;
}
function extractEvidence(content, startLine, ruleId, maxLength = 180) {
  const lines = content.split(/\r?\n/);
  const line = lines.find((value) => lineLooksRelevant(value, ruleId)) || lines[Math.max(0, startLine - 1)] || lines.find((value) => value.trim().length > 0) || "";
  const normalized = line.trim().replace(/\s+/g, " ");
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}\u2026`;
}
function findSuppressionFiles(targetPath, explicitWaiverFile) {
  const files = [];
  if (explicitWaiverFile) return [path.resolve(explicitWaiverFile)];
  const resolvedTarget = path.resolve(targetPath);
  const root = fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory() ? resolvedTarget : path.dirname(resolvedTarget);
  const candidate = path.join(root, ".promptsonar-waivers.yaml");
  if (fs.existsSync(candidate)) files.push(candidate);
  return files;
}
function extractInlineSuppressions(content) {
  const suppressions = /* @__PURE__ */ new Map();
  const lines = content.split(/\r?\n/);
  const add = (lineNumber, ruleId) => {
    const normalizedRule = (0, import_core.normalizeRuleId)(ruleId) || ruleId;
    const existing = suppressions.get(lineNumber) || /* @__PURE__ */ new Set();
    existing.add(normalizedRule);
    suppressions.set(lineNumber, existing);
  };
  lines.forEach((line, index) => {
    const currentLine = index + 1;
    const nextLineMatch = line.match(/promptsonar-ignore-next-line\s+([A-Za-z0-9_-]+)/);
    if (nextLineMatch) add(currentLine + 1, nextLineMatch[1]);
    const sameLineMatch = line.match(/promptsonar-ignore\s+([A-Za-z0-9_-]+)/);
    if (sameLineMatch && !line.includes("promptsonar-ignore-next-line")) add(currentLine, sameLineMatch[1]);
  });
  return suppressions;
}
function isInlineSuppressed(ruleId, promptStartLine, inlineSuppressions) {
  const normalizedRule = (0, import_core.normalizeRuleId)(ruleId) || ruleId;
  return Boolean(inlineSuppressions.get(promptStartLine)?.has(normalizedRule));
}
function isRecognizedMcpConfig(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("/mcp.json") || normalized.endsWith("/.vscode/mcp.json") || normalized.endsWith("/claude_desktop_config.json") || normalized === "mcp.json" || normalized === "claude_desktop_config.json";
}
function scoreFromFindings(findings) {
  return Math.max(0, 100 - findings.reduce((total, finding) => total + getPenaltyForSeverity(finding.severity), 0));
}
function statusFromFindings(findings) {
  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) return "fail";
  if (findings.length > 0) return "warn";
  return "pass";
}
function mapMcpFinding(finding, filePath) {
  const recommendation = finding.fix;
  const workflow = finding.workflow || (0, import_core.inferWorkflowForFinding)({
    ruleId: finding.rule_id,
    severity: finding.severity,
    text: `${finding.message}
${finding.fix}`,
    filePath,
    message: finding.message
  });
  return {
    rule_id: finding.rule_id,
    category: "security",
    severity: finding.severity,
    line: 1,
    column: 1,
    message: finding.message,
    fix: recommendation,
    owasp_ref: "",
    owasp: "",
    recommendation,
    evidence: finding.evidence ? `${finding.server ? `server: ${finding.server}; ` : ""}${finding.evidence}` : finding.server ? `server: ${finding.server}; path: ${finding.path}` : finding.path,
    confidence: getConfidenceForFinding(finding.rule_id, finding.severity),
    docs_url: getRuleDocsUrl(finding.rule_id),
    why: finding.message,
    risk: getRiskExplanation(finding.rule_id),
    waived: false,
    workflow
  };
}
function getCategoryForRule(ruleId) {
  if (ruleId.startsWith("sec_")) return "security";
  if (ruleId.startsWith("clarity_")) return "clarity";
  if (ruleId.startsWith("struct_")) return "structure";
  if (ruleId.startsWith("bp_")) return "best_practices";
  if (ruleId.startsWith("consist_")) return "consistency";
  if (ruleId.startsWith("eff_")) return "efficiency";
  if (ruleId.startsWith("ethics_")) return "ethics";
  return "security";
}
function getPenaltyForSeverity(severity) {
  switch (severity) {
    case "critical":
      return 30;
    case "high":
      return 20;
    case "medium":
      return 10;
    case "low":
      return 5;
    default:
      return 5;
  }
}
function computePillarScores(findings) {
  const pillars = {
    security: 100,
    clarity: 100,
    structure: 100,
    best_practices: 100,
    consistency: 100,
    efficiency: 100,
    ethics: 100
  };
  for (const f of findings) {
    const cat = getCategoryForRule(f.rule_id);
    if (cat in pillars) pillars[cat] = Math.max(0, pillars[cat] - getPenaltyForSeverity(f.severity));
  }
  return pillars;
}
var SUPPORTED_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".java",
  ".go",
  ".cs",
  ".prompt",
  ".ai",
  ".chat",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".txt"
];
var SUPPORTED_MARKDOWN_PROMPT_FILES = /* @__PURE__ */ new Set([
  "skill.md",
  "skills.md",
  "agent.md",
  "agents.md"
]);
var DEFAULT_IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/.git/**",
  "**/.vscode-test/**",
  "**/tests/**",
  "**/test/**",
  "**/__tests__/**",
  "**/docs/**",
  "**/evidence/**",
  "**/benchmarks/**",
  "**/examples/reports/**",
  "**/Agentsabha-angigravity/**",
  "**/custom-writer-skill/**",
  "**/my-writer-agent/**",
  "**/scratch/**",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.hot-update.js",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/.promptsonar-waivers.yaml",
  "**/.promptsonarignore",
  "**/.promptsonar-policy.yaml",
  "**/dummy_test.*",
  "**/generate_test.*",
  "**/generate_tests.*",
  "**/generate_dummies.*",
  "**/debug_*",
  "**/test_parser.*",
  "**/test_parse.*"
];
function getLanguageForExt(ext) {
  switch (ext) {
    case ".py":
      return "python";
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
      return "typescript";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".rs":
      return "rust";
    case ".cs":
      return "c_sharp";
    default:
      return "";
  }
}
async function scanFiles(targetPath, options) {
  const results = [];
  let activeSuppressions = [];
  for (const suppressionFile of findSuppressionFiles(targetPath, options.waiverFile)) {
    const waiverResult = (0, import_core.loadWaivers)(suppressionFile);
    activeSuppressions.push(...(0, import_core.getWaiverSuppressions)((0, import_core.getActiveWaivers)(waiverResult.waivers)));
    activeSuppressions.push(...(0, import_core.getActiveSuppressions)(waiverResult.suppressions));
  }
  const resolvedPath = path.resolve(targetPath);
  let files = [];
  if (fs.statSync(resolvedPath).isDirectory()) {
    const patterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*${ext}`);
    files = await (0, import_fast_glob.default)(patterns, {
      cwd: resolvedPath,
      absolute: true,
      ignore: DEFAULT_IGNORE_PATTERNS
    });
    const markdownPromptFiles = await (0, import_fast_glob.default)(["**/*.md"], {
      cwd: resolvedPath,
      absolute: true,
      ignore: DEFAULT_IGNORE_PATTERNS
    });
    files.push(
      ...markdownPromptFiles.filter(
        (filePath) => SUPPORTED_MARKDOWN_PROMPT_FILES.has(path.basename(filePath).toLowerCase())
      )
    );
    files = Array.from(new Set(files));
  } else {
    files = [resolvedPath];
  }
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filePath).toLowerCase();
    const language = getLanguageForExt(ext);
    const inlineSuppressions = extractInlineSuppressions(content);
    try {
      if (isRecognizedMcpConfig(filePath)) {
        const mcpResult = (0, import_core.auditMcpConfig)(filePath, content);
        if (mcpResult.findings.length > 0) {
          const scanFindings = mcpResult.findings.map((finding) => mapMcpFinding(finding, filePath));
          results.push({
            filePath,
            overall_score: scoreFromFindings(scanFindings),
            status: statusFromFindings(scanFindings),
            pillar_scores: computePillarScores(scanFindings),
            findings_count: scanFindings.length,
            findings: scanFindings
          });
          continue;
        }
      }
      const prompts = await (0, import_core.parseFile)({ filePath, content, language });
      for (const prompt of prompts) {
        const evalResult = (0, import_core.evaluatePrompt)(
          { text: prompt.text, language, context: { filePath } }
        );
        const scanFindings = evalResult.findings.map((f) => {
          const suppression = (0, import_core.isFindingSuppressed)(f.rule_id, filePath, activeSuppressions);
          const owasp = getOwaspRef(f.rule_id);
          const recommendation = getDeterministicRecommendation(f.rule_id, f.suggested_fix || "");
          const risk = getRiskExplanation(f.rule_id);
          const workflow = (0, import_core.inferWorkflowForFinding)({
            ruleId: f.rule_id,
            severity: f.severity,
            text: prompt.text,
            content,
            filePath,
            line: prompt.startLine,
            column: 1,
            message: f.explanation
          });
          const inlineSuppressed = isInlineSuppressed(f.rule_id, prompt.startLine, inlineSuppressions);
          return {
            rule_id: f.rule_id,
            category: getCategoryForRule(f.rule_id),
            severity: f.severity,
            line: prompt.startLine,
            column: 1,
            message: f.explanation,
            fix: recommendation,
            owasp_ref: owasp,
            owasp,
            recommendation,
            evidence: extractEvidence(content, prompt.startLine, f.rule_id),
            confidence: getConfidenceForFinding(f.rule_id, f.severity),
            docs_url: getRuleDocsUrl(f.rule_id),
            why: f.explanation,
            risk,
            waived: Boolean(suppression || inlineSuppressed),
            workflow,
            suppression_reason: suppression?.reason || (inlineSuppressed ? "Inline promptsonar-ignore comment" : void 0),
            suppression_source: suppression?.source || (inlineSuppressed ? "inline" : void 0)
          };
        });
        results.push({
          filePath,
          overall_score: evalResult.score,
          status: evalResult.status,
          pillar_scores: computePillarScores(scanFindings),
          findings_count: scanFindings.length,
          findings: scanFindings
        });
      }
    } catch (err) {
      if (options.verbose) {
        console.warn(`[PromptSonar] Skipping ${filePath}: ${err}`);
      }
    }
  }
  return results;
}
async function scanFileContent(filePath, content, options) {
  const results = [];
  let activeSuppressions = [];
  for (const suppressionFile of findSuppressionFiles(filePath, options.waiverFile)) {
    const waiverResult = (0, import_core.loadWaivers)(suppressionFile);
    activeSuppressions.push(...(0, import_core.getWaiverSuppressions)((0, import_core.getActiveWaivers)(waiverResult.waivers)));
    activeSuppressions.push(...(0, import_core.getActiveSuppressions)(waiverResult.suppressions));
  }
  const ext = path.extname(filePath).toLowerCase();
  const language = getLanguageForExt(ext);
  const inlineSuppressions = extractInlineSuppressions(content);
  try {
    if (isRecognizedMcpConfig(filePath)) {
      const mcpResult = (0, import_core.auditMcpConfig)(filePath, content);
      if (mcpResult.findings.length > 0) {
        const scanFindings = mcpResult.findings.map((finding) => mapMcpFinding(finding, filePath));
        results.push({
          filePath,
          overall_score: scoreFromFindings(scanFindings),
          status: statusFromFindings(scanFindings),
          pillar_scores: computePillarScores(scanFindings),
          findings_count: scanFindings.length,
          findings: scanFindings
        });
        return results;
      }
    }
    const prompts = await (0, import_core.parseFile)({ filePath, content, language });
    for (const prompt of prompts) {
      const evalResult = (0, import_core.evaluatePrompt)({ text: prompt.text, language, context: { filePath } });
      const scanFindings = evalResult.findings.map((f) => {
        const suppression = (0, import_core.isFindingSuppressed)(f.rule_id, filePath, activeSuppressions);
        const inlineSuppressed = isInlineSuppressed(f.rule_id, prompt.startLine, inlineSuppressions);
        const owasp = getOwaspRef(f.rule_id);
        const recommendation = getDeterministicRecommendation(f.rule_id, f.suggested_fix || "");
        const risk = getRiskExplanation(f.rule_id);
        const workflow = (0, import_core.inferWorkflowForFinding)({
          ruleId: f.rule_id,
          severity: f.severity,
          text: prompt.text,
          content,
          filePath,
          line: prompt.startLine,
          column: 1,
          message: f.explanation
        });
        return {
          rule_id: f.rule_id,
          category: getCategoryForRule(f.rule_id),
          severity: f.severity,
          line: prompt.startLine,
          column: 1,
          message: f.explanation,
          fix: recommendation,
          owasp_ref: owasp,
          owasp,
          recommendation,
          evidence: extractEvidence(content, prompt.startLine, f.rule_id),
          confidence: getConfidenceForFinding(f.rule_id, f.severity),
          docs_url: getRuleDocsUrl(f.rule_id),
          why: f.explanation,
          risk,
          waived: Boolean(suppression || inlineSuppressed),
          workflow,
          suppression_reason: suppression?.reason || (inlineSuppressed ? "Inline promptsonar-ignore comment" : void 0),
          suppression_source: suppression?.source || (inlineSuppressed ? "inline" : void 0)
        };
      });
      results.push({
        filePath,
        overall_score: evalResult.score,
        status: evalResult.status,
        pillar_scores: computePillarScores(scanFindings),
        findings_count: scanFindings.length,
        findings: scanFindings
      });
    }
  } catch (err) {
    if (options.verbose) {
      console.warn(`[PromptSonar] Skipping ${filePath}: ${err}`);
    }
  }
  return results;
}

// src/repository-summary.ts
var REPOSITORY_ARTIFACT_FILES = [
  "repository-report.json",
  "execution-map.json",
  "repository-report.html",
  "repository-report.sarif"
];
function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function repositorySummaryMarkdown(report) {
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  const NON_PRODUCTION = /* @__PURE__ */ new Set(["documentation", "test", "fixture", "example", "generated"]);
  const isProduction = (issue) => !NON_PRODUCTION.has(issue.provenance ?? "production");
  const topIssues = [...report.issues].sort(
    (left, right) => (isProduction(right) ? 1 : 0) - (isProduction(left) ? 1 : 0) || (severityRank[String(right.severity)] || 0) - (severityRank[String(left.severity)] || 0) || left.id.localeCompare(right.id)
  ).slice(0, 5);
  const topPaths = report.reachablePaths.slice(0, 5);
  const validation = report.pathValidation;
  const scanStats = report.summary.scanStats;
  return [
    "# PromptSonar Repository Analysis",
    "",
    "## Trust Status",
    "",
    `**${report.summary.trustStatus}** \xB7 ${(report.summary.productionIssueSummary ?? report.issueSummary).total} production issues \xB7 ${report.reachablePaths.length} reachable paths`,
    ...report.summary.productionIssueSummary && report.summary.nonProductionIssueSummary ? [
      "",
      `Production: ${report.summary.productionIssueSummary.critical} critical \xB7 ${report.summary.productionIssueSummary.high} high \xB7 ${report.summary.productionIssueSummary.medium} medium \xB7 ${report.summary.productionIssueSummary.low} low. Non-production (docs/tests/fixtures): ${report.summary.nonProductionIssueSummary.critical} critical \xB7 ${report.summary.nonProductionIssueSummary.high} high \xB7 ${report.summary.nonProductionIssueSummary.medium} medium \xB7 ${report.summary.nonProductionIssueSummary.low} low \u2014 not counted toward trust.`
    ] : [],
    "",
    validation && !validation.valid ? `> \u26A0\uFE0F **Path validation failed** \u2014 ${validation.errors.length} error${validation.errors.length === 1 ? "" : "s"} across ${validation.checkedPaths} checked paths. Treat path-derived results with caution (details in \`repository-report.json\`).` : `Path validation: passed (${validation ? validation.checkedPaths : 0} paths checked).`,
    ...scanStats ? [`Files: ${scanStats.filesConsidered} considered \xB7 ${scanStats.filesScanned} scanned \xB7 ${scanStats.filesSkipped} skipped${scanStats.truncated ? " \xB7 **\u26A0\uFE0F scan truncated at file limit**" : ""}`] : [],
    "",
    "## Top Issues",
    "",
    "| Severity | Context | Issue | Impacted Files | Quick Fix |",
    "| --- | --- | --- | --- | --- |",
    ...topIssues.length > 0 ? topIssues.map((issue) => `| ${markdownCell(String(issue.severity).toUpperCase())} | ${markdownCell(issue.provenance ?? "production")} | ${markdownCell(issue.issue)} | ${markdownCell(issue.impactedFiles.join(", "))} | ${markdownCell(issue.fix.quickFix)} |`) : ["| None | - | No active issues | - | - |"],
    "",
    `## Impacted Files (${report.impactedFiles.length})`,
    "",
    ...report.impactedFiles.length > 0 ? report.impactedFiles.slice(0, 15).map((file) => `- **${markdownCell(file.path)}** \xB7 ${file.issueCount} issue${file.issueCount === 1 ? "" : "s"} \xB7 highest severity: ${markdownCell(file.highestSeverity)}`) : ["No files are impacted by active issues."],
    ...report.impactedFiles.length > 15 ? [`- ${report.impactedFiles.length - 15} additional impacted files are available in the generated report.`] : [],
    "",
    `## Reachable Paths (${report.reachablePaths.length})`,
    "",
    ...topPaths.length > 0 ? topPaths.map((pathItem) => `- **${markdownCell(pathItem.risk.toUpperCase())} \xB7 ${markdownCell(pathItem.sensitiveActions.join(", "))}**: ${markdownCell(pathItem.explanation)}`) : ["No graph-backed sensitive-action paths were found."],
    ...report.reachablePaths.length > 5 ? [`- ${report.reachablePaths.length - 5} additional paths are available in the generated report.`] : [],
    "",
    "## Artifacts Generated",
    "",
    ...REPOSITORY_ARTIFACT_FILES.map((file) => `- \`${file}\``),
    "",
    "Artifact bundle: `promptsonar-repository-execution-analysis`"
  ].join("\n");
}

// src/action.ts
var PR_REVIEW_MARKER = "<!-- PROMPTSONAR_PR_REVIEW -->";
function readGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs2.existsSync(eventPath)) return void 0;
  try {
    return JSON.parse(fs2.readFileSync(eventPath, "utf-8"));
  } catch (error) {
    core.warning(`Unable to parse GitHub event payload: ${error.message}`);
    return void 0;
  }
}
function encodeGitHubContentPath(filePath) {
  return filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
function isPromptLikeFile(filePath) {
  const lower = filePath.toLowerCase();
  const ext = path2.extname(lower);
  if ([".md", ".prompt", ".yml", ".yaml", ".json", ".txt", ".ai", ".chat"].includes(ext)) return true;
  if (lower.endsWith("/mcp.json") || lower === "mcp.json") return true;
  if (lower.endsWith("claude_desktop_config.json")) return true;
  return false;
}
function isRecognizedMcpConfig2(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized.endsWith("/mcp.json") || normalized.endsWith("/.vscode/mcp.json") || normalized.endsWith("/claude_desktop_config.json") || normalized === "mcp.json" || normalized === "claude_desktop_config.json";
}
async function githubRequestJson(args) {
  const response = await fetch(args.url, {
    method: args.method ?? "GET",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: args.body ? JSON.stringify(args.body) : void 0
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub API ${args.method ?? "GET"} ${args.url} returned ${response.status}: ${detail}`);
  }
  return response.json();
}
async function listPullRequestFiles(args) {
  const files = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/files?per_page=100&page=${page}`;
    const batch = await githubRequestJson({ url, token: args.token });
    files.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return files;
}
async function getFileContentAtRef(args) {
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/contents/${encodeGitHubContentPath(args.filePath)}?ref=${encodeURIComponent(args.ref)}`;
  try {
    const json = await githubRequestJson({ url, token: args.token });
    if (!json || typeof json !== "object") return void 0;
    if (json.type !== "file") return void 0;
    if (typeof json.content !== "string" || typeof json.encoding !== "string") return void 0;
    if (json.encoding !== "base64") return void 0;
    return Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch {
    return void 0;
  }
}
async function upsertIssueComment(args) {
  const listUrl = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments?per_page=100`;
  const existing = await githubRequestJson({ url: listUrl, token: args.token });
  const match = existing.find((comment) => typeof comment.body === "string" && comment.body.includes(PR_REVIEW_MARKER));
  if (match) {
    const url2 = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/comments/${match.id}`;
    await githubRequestJson({ url: url2, token: args.token, method: "PATCH", body: { body: args.body } });
    return;
  }
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`;
  await githubRequestJson({ url, token: args.token, method: "POST", body: { body: args.body } });
}
async function createInlineReviewComments(args) {
  if (args.comments.length === 0) return;
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/reviews`;
  const payload = {
    commit_id: args.commitId,
    event: "COMMENT",
    comments: args.comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: "RIGHT",
      body: comment.body
    }))
  };
  await githubRequestJson({ url, token: args.token, method: "POST", body: payload });
}
async function uploadSarifToGitHub(args) {
  const sarif = fs2.readFileSync(args.sarifPath, "utf-8");
  const sarifBase64 = Buffer.from(sarif, "utf-8").toString("base64");
  const url = `https://api.github.com/repos/${args.owner}/${args.repo}/code-scanning/sarifs`;
  await githubRequestJson({
    url,
    token: args.token,
    method: "POST",
    body: {
      sarif: sarifBase64,
      commit_sha: args.commitSha,
      ref: args.ref,
      tool_name: "PromptSonar"
    }
  });
}
function collectExecutionPaths(results) {
  const sinks = /* @__PURE__ */ new Set();
  for (const r of results) {
    for (const f of r.findings) {
      if (f.waived) continue;
      const workflow = f.workflow;
      if (!workflow) continue;
      for (const node of workflow.path.nodes) {
        if (node.type === "shell_execution") sinks.add("Shell Execution");
        if (node.type === "network_access") sinks.add("Network Access");
        if (node.type === "filesystem_access") sinks.add("Filesystem Access");
        if (node.type === "credential_store") sinks.add("Credential Store");
        if (node.type === "external_api") sinks.add("External API");
      }
    }
  }
  return Array.from(sinks);
}
function computeConfidenceSummary(results) {
  let bestScore = -1;
  let bestLevel = "";
  for (const r of results) {
    for (const f of r.findings) {
      if (f.waived) continue;
      const wf = f.workflow;
      if (!wf || typeof wf.confidence_score !== "number" || !wf.confidence_level) continue;
      if (wf.confidence_score > bestScore) {
        bestScore = wf.confidence_score;
        bestLevel = wf.confidence_level;
      }
    }
  }
  if (bestScore < 0) return void 0;
  return { score: Math.round(bestScore), level: bestLevel };
}
function toCoreFindings(results) {
  const findings = [];
  for (const r of results) {
    for (const f of r.findings) {
      if (f.waived) continue;
      if (f.rule_id.startsWith("MCP-")) continue;
      findings.push({
        rule_id: f.rule_id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: f.category,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        severity: f.severity,
        explanation: f.message,
        suggested_fix: f.fix,
        workflow: f.workflow
      });
    }
  }
  return findings;
}
function pickHighestRiskWorkflowGraph(results) {
  let best = { riskScore: -1 };
  for (const r of results) {
    for (const f of r.findings) {
      if (f.waived) continue;
      const wf = f.workflow;
      if (!wf) continue;
      const graph = (0, import_core2.pathToGraph)(wf.path);
      if (graph.riskScore > best.riskScore) {
        best = { riskScore: graph.riskScore, summary: (0, import_core2.workflowPathSummary)(wf), graph };
      }
    }
  }
  return { summary: best.summary, graph: best.graph };
}
function computeWorkflowDiffForFile(args) {
  const beforePick = pickHighestRiskWorkflowGraph(args.before);
  const afterPick = pickHighestRiskWorkflowGraph(args.after);
  const beforeGraph = beforePick.graph;
  const afterGraph = afterPick.graph;
  if (!beforeGraph && !afterGraph) return { introduced: false, removed: false };
  if (!beforeGraph && afterGraph) return { introduced: afterGraph.privilegedSinkReached, removed: false, afterSummary: afterPick.summary };
  if (beforeGraph && !afterGraph) return { introduced: false, removed: beforeGraph.privilegedSinkReached, beforeSummary: beforePick.summary };
  const diff = (0, import_core2.computeWorkflowDiff)(beforeGraph, afterGraph);
  const introduced = !beforeGraph.privilegedSinkReached && afterGraph.privilegedSinkReached;
  return { diff, introduced, removed: diff.executionPathRemoved, beforeSummary: beforePick.summary, afterSummary: afterPick.summary, riskReduction: diff.riskReduction };
}
async function run() {
  try {
    const failOn = core.getInput("fail-on") || "critical";
    const waiverFile = core.getInput("waiver-file") || ".promptsonar-waivers.yaml";
    const uploadSarif = core.getInput("upload-sarif") === "true";
    const diffOnlyInput = core.getInput("diff-only") === "true";
    const workspace = process.env.GITHUB_WORKSPACE || ".";
    const waiverPath = fs2.existsSync(path2.join(workspace, waiverFile)) ? path2.join(workspace, waiverFile) : fs2.existsSync(waiverFile) ? path2.resolve(waiverFile) : void 0;
    const configPathCandidates = [
      path2.join(workspace, ".promptsonar.yml"),
      path2.join(workspace, ".promptsonar.yaml")
    ];
    const configPath = configPathCandidates.find((candidate) => fs2.existsSync(candidate));
    const config = configPath ? (0, import_core2.parsePromptSonarPrReviewConfig)(fs2.readFileSync(configPath, "utf-8")) : failOn === "none" ? { fail_on: [] } : (0, import_core2.parsePromptSonarPrReviewConfig)(`fail_on:
  - ${failOn}
`);
    const event = readGitHubEvent();
    const pullRequest = event?.pull_request;
    const repoFull = event?.repository?.full_name || process.env.GITHUB_REPOSITORY || "";
    const [owner, repo] = repoFull.split("/");
    const token = process.env.GITHUB_TOKEN;
    const isPrContext = Boolean(pullRequest && owner && repo && token);
    const diffOnly = isPrContext ? true : diffOnlyInput;
    let changedFiles = [];
    if (isPrContext && pullRequest) {
      changedFiles = await listPullRequestFiles({ owner, repo, pullNumber: pullRequest.number, token });
    }
    const scannableFiles = diffOnly && isPrContext ? changedFiles.filter((file) => file.status !== "removed" && isPromptLikeFile(file.filename)) : [];
    const results = [];
    let maxMcpRiskScore = void 0;
    let mcpSummary = void 0;
    if (diffOnly && isPrContext) {
      for (const file of scannableFiles) {
        const abs = path2.join(workspace, file.filename);
        if (!fs2.existsSync(abs) || fs2.statSync(abs).isDirectory()) continue;
        const content = fs2.readFileSync(abs, "utf-8");
        if (isRecognizedMcpConfig2(file.filename)) {
          const mcp = (0, import_core2.auditMcpConfig)(file.filename, content);
          if (typeof mcp.risk_score === "number") {
            maxMcpRiskScore = maxMcpRiskScore === void 0 ? mcp.risk_score : Math.max(maxMcpRiskScore, mcp.risk_score);
            const caps = Array.from(new Set((mcp.servers || []).flatMap((server) => server.capabilities || [])));
            const approvalMode = (mcp.servers || []).some((server) => server.execution_mode === "auto") ? "Automatic" : (mcp.servers || []).some((server) => server.execution_mode === "manual") ? "Manual" : "Unknown";
            const severity = mcp.risk_score >= 85 ? "CRITICAL" : mcp.risk_score >= 60 ? "HIGH" : mcp.risk_score >= 30 ? "MEDIUM" : "LOW";
            if (!mcpSummary || mcp.risk_score > mcpSummary.score) {
              mcpSummary = { score: mcp.risk_score, severity, capabilities: caps, approvalMode };
            }
          }
        }
        const res = await scanFileContent(file.filename, content, { verbose: false, waiverFile: waiverPath });
        results.push(...res);
      }
    } else {
      results.push(...await scanFiles(workspace, { verbose: false, diffOnly: false, waiverFile: waiverPath }));
    }
    let worstScore = 100;
    for (const r of results) worstScore = Math.min(worstScore, r.overall_score);
    const repositoryReport = (0, import_core2.analyzeRepositoryExecution)(workspace, results);
    const counts = {
      critical: repositoryReport.issueSummary.critical,
      high: repositoryReport.issueSummary.high,
      medium: repositoryReport.issueSummary.medium
    };
    core.setOutput("score", worstScore.toString());
    core.setOutput("criticals", counts.critical.toString());
    core.setOutput("highs", counts.high.toString());
    core.setOutput("critical_count", counts.critical.toString());
    core.setOutput("high_count", counts.high.toString());
    core.setOutput("medium_count", counts.medium.toString());
    core.setOutput("files_scanned", (diffOnly && isPrContext ? scannableFiles.length : results.length).toString());
    core.setOutput("execution_paths", JSON.stringify(collectExecutionPaths(results)));
    core.setOutput("mcp_risk_score", maxMcpRiskScore === void 0 ? "" : String(maxMcpRiskScore));
    const confidenceOut = computeConfidenceSummary(results);
    core.setOutput("confidence_score", confidenceOut ? String(confidenceOut.score) : "");
    core.setOutput("confidence_level", confidenceOut ? confidenceOut.level : "");
    core.setOutput("issue_count", String(repositoryReport.issueSummary.total));
    core.setOutput("issue_ids", JSON.stringify(repositoryReport.issues.map((issue) => issue.id)));
    const sarifPath = path2.join(workspace, "promptsonar-results.sarif");
    fs2.writeFileSync(sarifPath, (0, import_core2.formatRepositoryReportSarif)(repositoryReport), "utf-8");
    core.setOutput("sarif-path", sarifPath);
    const repositoryReportPath = path2.join(workspace, REPOSITORY_ARTIFACT_FILES[0]);
    const executionMapPath = path2.join(workspace, REPOSITORY_ARTIFACT_FILES[1]);
    const repositoryHtmlPath = path2.join(workspace, REPOSITORY_ARTIFACT_FILES[2]);
    const repositorySarifPath = path2.join(workspace, REPOSITORY_ARTIFACT_FILES[3]);
    fs2.writeFileSync(repositoryReportPath, (0, import_core2.formatRepositoryReportJson)(repositoryReport), "utf-8");
    fs2.writeFileSync(executionMapPath, JSON.stringify(repositoryReport.executionMap, null, 2), "utf-8");
    fs2.writeFileSync(repositoryHtmlPath, (0, import_core2.formatRepositoryReportHtml)(repositoryReport), "utf-8");
    fs2.writeFileSync(repositorySarifPath, (0, import_core2.formatRepositoryReportSarif)(repositoryReport), "utf-8");
    core.setOutput("repository-report-path", repositoryReportPath);
    core.setOutput("execution-map-path", executionMapPath);
    core.setOutput("repository-html-report-path", repositoryHtmlPath);
    core.setOutput("repository-sarif-path", repositorySarifPath);
    core.setOutput("trust_status", repositoryReport.summary.trustStatus);
    core.setOutput("reachable_sensitive_actions", String(repositoryReport.reachablePaths.length));
    core.setOutput("high_risk_paths", String(repositoryReport.summary.riskSummary.high));
    if (core.summary) {
      await core.summary.addRaw(repositorySummaryMarkdown(repositoryReport)).write();
    }
    try {
      const { DefaultArtifactClient } = await import("@actions/artifact");
      const artifactClient = new DefaultArtifactClient();
      await artifactClient.uploadArtifact("promptsonar-repository-execution-analysis", [
        repositoryReportPath,
        executionMapPath,
        repositoryHtmlPath,
        repositorySarifPath
      ], workspace);
      core.info("Repository execution analysis artifacts uploaded.");
    } catch (error) {
      core.warning(`Unable to upload repository execution artifacts: ${error.message}`);
    }
    if (uploadSarif && isPrContext && token) {
      const commitSha = pullRequest?.head?.sha || process.env.GITHUB_SHA || "";
      const branch = pullRequest?.head?.ref || process.env.GITHUB_REF_NAME || "";
      const ref = branch ? `refs/heads/${branch}` : "";
      if (commitSha && ref) {
        await uploadSarifToGitHub({ owner, repo, token, sarifPath, commitSha, ref });
        core.info("SARIF uploaded to GitHub code scanning.");
      }
    }
    const workflowDiffSummaries = [];
    const workflowDiffEntries = [];
    const inlineComments = [];
    if (isPrContext && pullRequest && token && diffOnly) {
      const baseSha = pullRequest.base?.sha;
      const headSha = pullRequest.head?.sha || process.env.GITHUB_SHA || "";
      for (const file of scannableFiles) {
        if (!baseSha) continue;
        const afterAbs = path2.join(workspace, file.filename);
        if (!fs2.existsSync(afterAbs)) continue;
        const afterContent = fs2.readFileSync(afterAbs, "utf-8");
        const beforePath = file.previous_filename || file.filename;
        const beforeContent = await getFileContentAtRef({ owner, repo, filePath: beforePath, ref: baseSha, token });
        if (!beforeContent) continue;
        const beforeResults = await scanFileContent(beforePath, beforeContent, { verbose: false, waiverFile: waiverPath });
        const afterResults = await scanFileContent(file.filename, afterContent, { verbose: false, waiverFile: waiverPath });
        const diff = computeWorkflowDiffForFile({ before: beforeResults, after: afterResults });
        workflowDiffSummaries.push({ filePath: file.filename, diff: diff.diff, executionPathIntroduced: diff.introduced });
        workflowDiffEntries.push({
          filePath: file.filename,
          before: diff.beforeSummary,
          after: diff.afterSummary,
          introduced: diff.introduced,
          removed: diff.removed,
          riskReduction: diff.riskReduction
        });
        const patchLines = file.patch ? (0, import_core2.extractChangedLinesFromGitHubPatch)(file.patch) : /* @__PURE__ */ new Set();
        for (const issue of repositoryReport.issues) {
          if (!(issue.severity === "critical" || issue.severity === "high")) continue;
          if (!issue.impactedFiles.includes(file.filename.replace(/\\/g, "/"))) continue;
          const evidence = issue.evidence[0];
          const line = evidence?.line || 1;
          if (!patchLines.has(line)) continue;
          inlineComments.push({
            path: file.filename,
            line,
            body: `**${issue.id}** (${issue.severity})

**Issue:** ${issue.issue}

**Impact:** ${issue.impact}

**Why this matters:** ${issue.whyThisMatters}

**Quick Fix:** ${issue.fix.quickFix}

**Recommended Fix:** ${issue.fix.recommendedFix}

**Safe Pattern:** \`${issue.fix.safePattern}\`

**Effort:** ${issue.fix.effort}

<details><summary>Technical Details</summary>

**Execution path:** ${issue.technicalDetails.executionPath}

**Evidence:** \`${evidence?.snippet || issue.issue}\`

**Confidence:** ${issue.technicalDetails.confidence.label} (${issue.technicalDetails.confidence.score}%) \u2014 ${issue.technicalDetails.confidence.definition}

</details>`
          });
        }
      }
      const coreFindings = toCoreFindings(results);
      const analysis = (0, import_core2.analyzeRootCause)(coreFindings);
      const rootCause = analysis ? {
        name: (0, import_core2.humanRuleName)(analysis.rootCause.rule_id),
        supporting: analysis.supportingFindings.map((f) => (0, import_core2.humanRuleName)(f.rule_id))
      } : void 0;
      const provenanceEvidence = analysis?.rootCause.workflow?.workflow_evidence || analysis?.rootCause.workflow?.evidence?.map((e) => e.label) || [];
      const confidence = computeConfidenceSummary(results);
      const execPaths = collectExecutionPaths(results);
      const body = (0, import_core2.buildPrReviewSummaryMarkdown)({
        filesScanned: scannableFiles.length,
        counts,
        executionPaths: execPaths,
        confidence,
        rootCause,
        provenanceEvidence: provenanceEvidence.slice(0, 6),
        mcpRisk: mcpSummary,
        workflowDiffs: workflowDiffEntries
      });
      await upsertIssueComment({
        owner,
        repo,
        issueNumber: pullRequest.number,
        token,
        body: `${PR_REVIEW_MARKER}
${body}`
      });
      await createInlineReviewComments({
        owner,
        repo,
        pullNumber: pullRequest.number,
        token,
        commitId: headSha,
        comments: inlineComments.slice(0, 20)
      });
      core.setOutput("workflow_diff", JSON.stringify(workflowDiffEntries));
    }
    const decision = (0, import_core2.evaluatePrReviewGates)(config, {
      counts,
      workflowDiffs: workflowDiffSummaries,
      mcpRiskScore: maxMcpRiskScore
    });
    if (decision.shouldFail) {
      core.setFailed(decision.reason || `PromptSonar: policy gate failed. Score: ${worstScore}/100`);
    }
  } catch (error) {
    core.setFailed(`PromptSonar Action failed: ${error.message}`);
  }
}
run();
