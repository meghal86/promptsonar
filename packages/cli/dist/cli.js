#!/usr/bin/env node
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

// src/cli.ts
var import_commander = require("commander");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var import_chalk2 = __toESM(require("chalk"));

// src/scanner.ts
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
    if (cat in pillars) {
      pillars[cat] = Math.max(0, pillars[cat] - getPenaltyForSeverity(f.severity));
    }
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
    if (waiverResult.errors.length > 0 && options.verbose) {
      for (const err of waiverResult.errors) {
        console.warn(`[PromptSonar] Waiver warning: ${err}`);
      }
    }
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

// src/formatters.ts
var import_chalk = __toESM(require("chalk"));
var VERSION = "1.0.23";
var SEVERITY_DISPLAY = {
  critical: { emoji: "\u{1F534}", color: import_chalk.default.red, label: "CRITICAL" },
  high: { emoji: "\u{1F7E0}", color: import_chalk.default.hex("#FF8C00"), label: "HIGH" },
  medium: { emoji: "\u{1F7E1}", color: import_chalk.default.yellow, label: "MEDIUM" },
  low: { emoji: "\u{1F535}", color: import_chalk.default.blue, label: "LOW" }
};
function formatJson(results) {
  const output = results.map((r) => ({
    version: VERSION,
    scanned_at: (/* @__PURE__ */ new Date()).toISOString(),
    file: r.filePath,
    overall_score: r.overall_score,
    status: r.status,
    pillar_scores: r.pillar_scores,
    findings_count: r.findings_count,
    findings: r.findings
  }));
  if (output.length === 1) {
    return JSON.stringify(output[0], null, 2);
  }
  return JSON.stringify(output, null, 2);
}
function formatTerminal(results) {
  const lines = [];
  for (const result of results) {
    lines.push("");
    lines.push(import_chalk.default.bold(`PromptSonar v${VERSION}`) + ` \u2014 scanning ${import_chalk.default.underline(result.filePath)}`);
    lines.push("");
    if (result.findings.length === 0) {
      lines.push(import_chalk.default.green("  \u2705 No findings. Prompt looks clean!"));
    } else {
      for (const f of result.findings) {
        const sev = SEVERITY_DISPLAY[f.severity] || SEVERITY_DISPLAY.low;
        if (f.waived) {
          lines.push(import_chalk.default.dim(`  \u26A0\uFE0F  ${sev.label.padEnd(10)} ${f.rule_id}  [WAIVED]`));
          lines.push(import_chalk.default.dim(`     Line ${f.line}:${f.column} \u2014 ${f.message}`));
        } else {
          lines.push(`  ${sev.emoji} ${sev.color(sev.label.padEnd(10))} ${import_chalk.default.bold(f.rule_id)}`);
          lines.push(`     Line ${f.line}:${f.column} \u2014 ${f.message}`);
          if (f.fix) {
            lines.push(`     Fix: ${f.fix}`);
          }
        }
        lines.push("");
      }
    }
    const statusIcon = result.status === "pass" ? "\u2705 PASS" : result.status === "warn" ? "\u26A0\uFE0F  WARN" : "\u274C FAIL";
    const statusColor = result.status === "pass" ? import_chalk.default.green : result.status === "warn" ? import_chalk.default.yellow : import_chalk.default.red;
    const severityCounts = {};
    for (const f of result.findings) {
      severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
    }
    const countParts = Object.entries(severityCounts).map(([sev, count]) => `${count} ${sev}`);
    const countStr = countParts.length > 0 ? ` (${result.findings_count} findings: ${countParts.join(", ")})` : "";
    lines.push(statusColor(`Score: ${result.overall_score}/100 ${statusIcon}`) + countStr);
    lines.push("");
  }
  return lines.join("\n");
}
function getExitCode(results, failOn) {
  const severityOrder = ["critical", "high", "medium", "low", "none"];
  const failOnIndex = severityOrder.indexOf(failOn);
  if (failOn === "none" || failOnIndex === -1) return 0;
  let hasCritical = false;
  let hasHigh = false;
  let hasMedium = false;
  for (const result of results) {
    for (const f of result.findings) {
      if (f.waived) continue;
      if (f.severity === "critical") hasCritical = true;
      if (f.severity === "high") hasHigh = true;
      if (f.severity === "medium") hasMedium = true;
    }
  }
  if (hasCritical && failOnIndex <= 0) return 1;
  if (hasHigh && failOnIndex <= 1) return 2;
  if (hasMedium && failOnIndex <= 2) return 3;
  return 0;
}

// src/cli.ts
var import_core2 = require("core");
var VERSION2 = "1.0.23";
var program = new import_commander.Command();
program.name("promptsonar").description("Static security scanner for LLM prompts").version(VERSION2);
program.command("scan").description("Scan a directory or file for prompt vulnerabilities").argument("<path>", "Path to file or directory to scan").option("-v, --verbose", "Show detailed scan information").option("--json", "Output results in JSON format").option("--sarif", "Output results in SARIF format").option("--report <file>", "Generate a visual HTML report").option("--output <file>", "Write results to a file").option("--fail-on <severity>", "Exit code threshold (critical|high|medium|low)", "critical").option("--waiver <file>", "Path to a .promptsonar.json waiver file").action(async (targetPath, options) => {
  try {
    const results = await scanFiles(targetPath, {
      verbose: options.verbose,
      waiverFile: options.waiver
    });
    let output;
    if (options.sarif) {
      output = generateSarif(results);
    } else if (options.json) {
      output = formatJson(results);
    } else {
      output = formatTerminal(results);
    }
    if (options.output) {
      fs2.writeFileSync(path2.resolve(options.output), output, "utf-8");
      console.log(import_chalk2.default.green(`\u2705 Results written to ${options.output}`));
    } else {
      console.log(output);
    }
    if (options.report) {
      const reportPath = path2.resolve(options.report);
      let allFindings = [];
      let totalScore = 0;
      let promptsEvaluated = 0;
      for (const res of results) {
        const basename2 = path2.basename(res.filePath);
        allFindings.push(...res.findings.map((f) => ({
          rule_id: f.rule_id,
          severity: f.severity,
          category: f.category || "security",
          explanation: f.message,
          suggested_fix: f.fix,
          file: basename2
        })));
        totalScore += res.overall_score;
        promptsEvaluated++;
      }
      const avgScore = promptsEvaluated > 0 ? Math.round(totalScore / promptsEvaluated) : 100;
      const hasCritical = allFindings.some((f) => f.severity === "critical");
      const masterResult = {
        score: hasCritical ? Math.min(avgScore, 49) : avgScore,
        status: hasCritical || avgScore < 70 ? "fail" : avgScore < 85 ? "warn" : "pass",
        findings: allFindings
      };
      const html = (0, import_core2.generateHtmlReport)(masterResult, "Workspace Scan Summary", "");
      fs2.writeFileSync(reportPath, html);
      console.log(import_chalk2.default.green.bold(`
\u2728 Visual report generated: ${reportPath}`));
    }
    process.exit(getExitCode(results, options.failOn));
  } catch (err) {
    console.error(import_chalk2.default.red(`[PromptSonar] Error: ${err.message}`));
    if (options.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
});
program.parse();
