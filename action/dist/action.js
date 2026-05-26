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
  if (ruleId.startsWith("sec_owasp_llm02") || ruleId.includes("evasion") || ruleId.includes("zero_width") || ruleId.includes("base64")) return "HIGH";
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
function lineLooksRelevant(line, ruleId) {
  const lower = line.toLowerCase();
  if (ruleId.includes("llm01") || ruleId.includes("injection")) return /ignore|disregard|forget|dan|developer mode|system prompt|previous instructions|jailbreak|bypass/.test(lower);
  if (ruleId.includes("pii")) return /sk-|api[_ -]?key|secret|token|password|bearer|ssn|credit card|\d{3}-\d{2}-\d{4}/.test(lower);
  if (ruleId.includes("zero_width")) return /[\u200B-\u200D\uFEFF]/.test(line);
  if (ruleId.includes("homoglyph") || ruleId.includes("unicode")) return /[^\x00-\x7F]/.test(line);
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
  ".yaml"
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
    try {
      const prompts = await (0, import_core.parseFile)({ filePath, content, language });
      for (const prompt of prompts) {
        const evalResult = (0, import_core.evaluatePrompt)(
          { text: prompt.text, language, context: { filePath } }
        );
        const scanFindings = evalResult.findings.map((f) => {
          const suppression = (0, import_core.isFindingSuppressed)(f.rule_id, filePath, activeSuppressions);
          const owasp = getOwaspRef(f.rule_id);
          const recommendation = getDeterministicRecommendation(f.rule_id, f.suggested_fix || "");
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
            waived: Boolean(suppression),
            suppression_reason: suppression?.reason,
            suppression_source: suppression?.source
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
function generateSarif(results) {
  const allFindings = [];
  const primaryFile = results.length > 0 ? results[0].filePath : "unknown";
  for (const result of results) {
    for (const f of result.findings) {
      allFindings.push({
        rule_id: f.rule_id,
        category: getCategoryForRule(f.rule_id),
        severity: f.severity,
        explanation: f.message,
        suggested_fix: f.fix,
        filePath: result.filePath,
        line: f.line,
        column: f.column,
        evidence: f.evidence,
        recommendation: f.recommendation,
        owasp: f.owasp,
        confidence: f.confidence,
        docs_url: f.docs_url
      });
    }
  }
  return (0, import_sarif.formatToSarif)(allFindings, primaryFile);
}

// src/action.ts
function buildPrComment(results, sha, branch, repo) {
  let totalCriticals = 0;
  let totalHighs = 0;
  let totalMediums = 0;
  let bestScore = 100;
  for (const r of results) {
    if (r.overall_score < bestScore) bestScore = r.overall_score;
    for (const f of r.findings) {
      if (f.waived) continue;
      if (f.severity === "critical") totalCriticals++;
      else if (f.severity === "high") totalHighs++;
      else if (f.severity === "medium") totalMediums++;
    }
  }
  const critStatus = totalCriticals > 0 ? "\u274C Blocked" : "\u2705 Pass";
  const highStatus = totalHighs > 0 ? "\u26A0\uFE0F Review" : "\u2705 Pass";
  let comment = `## \u{1F50D} PromptSonar \u2014 Prompt Security Scan

`;
  comment += `**Score: ${bestScore}/100** | Commit: ${sha.substring(0, 7)} | Branch: ${branch}

`;
  comment += `| Severity | Found | Status |
`;
  comment += `|----------|-------|--------|
`;
  comment += `| \u{1F534} Critical | ${totalCriticals} | ${critStatus} |
`;
  comment += `| \u{1F7E0} High     | ${totalHighs} | ${highStatus} |
`;
  comment += `| \u{1F7E1} Medium   | ${totalMediums} | \u2139\uFE0F Info |

`;
  for (const r of results) {
    for (const f of r.findings) {
      if (f.waived) continue;
      const sevLabel = f.severity.toUpperCase();
      comment += `**${sevLabel}** \u2014 \`${f.rule_id}\`
`;
      comment += `File: \`${r.filePath}:${f.line}\`
`;
      comment += `Fix: ${f.fix}

`;
    }
  }
  comment += `\u{1F517} [View in GitHub Security](https://github.com/${repo}/security/code-scanning)
`;
  return comment;
}
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
async function postPullRequestComment(body, issueNumber, repo, token) {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repo}`);
  }
  const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ body })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub comment API returned ${response.status}: ${detail}`);
  }
}
async function run() {
  try {
    const failOn = core.getInput("fail-on") || "critical";
    const waiverFile = core.getInput("waiver-file") || ".promptsonar-waivers.yaml";
    const uploadSarif = core.getInput("upload-sarif") === "true";
    const diffOnly = core.getInput("diff-only") === "true";
    const workspace = process.env.GITHUB_WORKSPACE || ".";
    const results = await scanFiles(workspace, {
      verbose: false,
      diffOnly,
      waiverFile: fs2.existsSync(waiverFile) ? waiverFile : void 0
    });
    let worstScore = 100;
    let totalCriticals = 0;
    let totalHighs = 0;
    for (const r of results) {
      if (r.overall_score < worstScore) worstScore = r.overall_score;
      for (const f of r.findings) {
        if (f.waived) continue;
        if (f.severity === "critical") totalCriticals++;
        else if (f.severity === "high") totalHighs++;
      }
    }
    core.setOutput("score", worstScore.toString());
    core.setOutput("criticals", totalCriticals.toString());
    core.setOutput("highs", totalHighs.toString());
    const sarifPath = path2.join(workspace, "promptsonar-results.sarif");
    const sarifContent = generateSarif(results);
    fs2.writeFileSync(sarifPath, sarifContent, "utf-8");
    core.setOutput("sarif-path", sarifPath);
    if (uploadSarif) {
      core.info(`SARIF written to ${sarifPath}. Upload to GitHub Security tab via github/codeql-action/upload-sarif.`);
    }
    const event = readGitHubEvent();
    const pullRequest = event?.pull_request;
    if (pullRequest) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const repo = event?.repository?.full_name || process.env.GITHUB_REPOSITORY || "";
        const sha = pullRequest.head?.sha || process.env.GITHUB_SHA || "";
        const branch = pullRequest.head?.ref || process.env.GITHUB_REF_NAME || "";
        const body = buildPrComment(results, sha, branch, repo);
        await postPullRequestComment(body, pullRequest.number, repo, token);
        core.info("PR comment posted successfully.");
      } else {
        core.warning("GITHUB_TOKEN not available. Skipping PR comment.");
      }
    }
    const severityOrder = ["critical", "high", "medium", "low", "none"];
    const failOnIndex = severityOrder.indexOf(failOn);
    if (totalCriticals > 0 && failOnIndex <= 0) {
      core.setFailed(`PromptSonar: ${totalCriticals} critical finding(s) detected. Score: ${worstScore}/100`);
    } else if (totalHighs > 0 && failOnIndex <= 1) {
      core.setFailed(`PromptSonar: ${totalHighs} high finding(s) detected. Score: ${worstScore}/100`);
    }
  } catch (error) {
    core.setFailed(`PromptSonar Action failed: ${error.message}`);
  }
}
run();
