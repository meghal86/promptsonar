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
var github = __toESM(require("@actions/github"));
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/scanner-bridge.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_fast_glob = __toESM(require("fast-glob"));
var import_core = require("core");
var import_sarif = require("core/dist/formatter/sarif");
function getOwaspRef(ruleId) {
  if (ruleId.startsWith("sec_owasp_llm01") || ruleId.startsWith("sec_unicode") || ruleId === "sec_unbounded_persona") return "LLM01";
  if (ruleId.startsWith("sec_owasp_llm02")) return "LLM02";
  if (ruleId === "sec_unbounded_access" || ruleId === "sec_rag_injection") return "LLM07";
  return "";
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
  let activeWaivers = [];
  if (options.waiverFile) {
    const waiverResult = (0, import_core.loadWaivers)(options.waiverFile);
    activeWaivers = (0, import_core.getActiveWaivers)(waiverResult.waivers);
  }
  const resolvedPath = path.resolve(targetPath);
  let files = [];
  if (fs.statSync(resolvedPath).isDirectory()) {
    const patterns = SUPPORTED_EXTENSIONS.map((ext) => `**/*${ext}`);
    files = await (0, import_fast_glob.default)(patterns, {
      cwd: resolvedPath,
      absolute: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"]
    });
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
          const waived = (0, import_core.isFindingWaived)(f.rule_id, filePath, activeWaivers);
          return {
            rule_id: f.rule_id,
            severity: f.severity,
            line: prompt.startLine,
            column: 1,
            message: f.explanation,
            fix: f.suggested_fix || "",
            owasp_ref: getOwaspRef(f.rule_id),
            docs_url: `https://github.com/meghal86/promptsonar/wiki/rules/${f.rule_id}`,
            waived
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
        suggested_fix: f.fix
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
    const context2 = github.context;
    if (context2.payload.pull_request) {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        const repo = `${context2.repo.owner}/${context2.repo.repo}`;
        const sha = context2.payload.pull_request.head.sha || context2.sha;
        const branch = context2.payload.pull_request.head.ref || "";
        const body = buildPrComment(results, sha, branch, repo);
        await octokit.rest.issues.createComment({
          ...context2.repo,
          issue_number: context2.payload.pull_request.number,
          body
        });
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
