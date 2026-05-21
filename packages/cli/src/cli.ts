#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { scanFiles, generateSarif } from './scanner';
import { formatJson, formatTerminal, getExitCode, formatArticle19 } from './formatters';
import { generateHtmlReport, calculateROI, compressPromptLLMLingua, generatePromptSBOM, parseGovernancePolicy, evaluateGovernancePolicy, validatePromptAgainstContract, runCrossModelEvaluation, auditDiscoveredMcpConfigs, getMcpExitCode, McpAuditResult } from '@promptsonar/core';
import { runPromptTests } from './tester';

const VERSION = '1.1.0';

const program = new Command();

program
    .name('promptsonar')
    .description('Static security scanner for LLM prompts')
    .version(VERSION);

program
    .command('scan')
    .description('Scan a directory or file for prompt vulnerabilities')
    .argument('<path>', 'Path to file or directory to scan')
    .option('-v, --verbose', 'Show detailed scan information')
    .option('--json', 'Output results in JSON format')
    .option('--sarif', 'Output results in SARIF format')
    .option('--report <file>', 'Generate a visual HTML report')
    .option('--output <file>', 'Write results to a file')
    .option('--fail-on <severity>', 'Exit code threshold (critical|high|medium|low)', 'critical')
    .option('--waiver <file>', 'Path to a .promptsonar.json waiver file')
    .option('--policy-file <file>', 'Path to a .promptsonar-policy.yaml governance file')
    .action(async (targetPath, options) => {
        try {
            const results = await scanFiles(targetPath, {
                verbose: options.verbose,
                waiverFile: options.waiver
            });

            // Format output
            let output: string;
            if (options.sarif) {
                output = generateSarif(results);
            } else if (options.json) {
                output = formatJson(results);
            } else {
                output = formatTerminal(results);
            }

            // Write to file or print
            if (options.output) {
                fs.writeFileSync(path.resolve(options.output), output, 'utf-8');
                console.log(chalk.green(`✅ Results written to ${options.output}`));
            } else {
                console.log(output);
            }

            // Generate HTML report if requested
            if (options.report) {
                const reportPath = path.resolve(options.report);

                // Aggregate results for the report
                let allFindings: any[] = [];
                let totalScore = 0;
                let promptsEvaluated = 0;

                for (const res of results) {
                    const basename = path.basename(res.filePath);
                    allFindings.push(...res.findings.map(f => ({
                        rule_id: f.rule_id,
                        severity: f.severity,
                        category: f.category || 'security',
                        explanation: f.message,
                        suggested_fix: f.fix,
                        line: f.line,
                        file: basename
                    })));
                    totalScore += res.overall_score;
                    promptsEvaluated++;
                }

                const avgScore = promptsEvaluated > 0 ? Math.round(totalScore / promptsEvaluated) : 100;
                const hasCritical = allFindings.some(f => f.severity === 'critical');

                const masterResult = {
                    score: hasCritical ? Math.min(avgScore, 49) : avgScore,
                    status: (hasCritical || avgScore < 70) ? 'fail' : (avgScore < 85 ? 'warn' : 'pass'),
                    findings: allFindings
                };

                const html = generateHtmlReport(masterResult as any, "Workspace Scan Summary", "");
                fs.writeFileSync(reportPath, html);
                console.log(chalk.green.bold(`\n✨ Visual report generated: ${reportPath}`));
            }

            // Governance Evaluation
            if (options.policyFile) {
                console.log(chalk.blue(`[PromptSonar] Evaluating Governance Policy from ${options.policyFile}...`));
                const policy = parseGovernancePolicy(options.policyFile);
                const govResults = evaluateGovernancePolicy(results, policy);
                
                if (!govResults.passed) {
                    console.error(chalk.red.bold('\n❌ Governance Policy Violations:'));
                    govResults.violations.forEach((v: string) => console.error(chalk.red(`  - ${v}`)));
                    process.exit(1); 
                } else {
                    console.log(chalk.green('✅ Passed all Governance Policy checks.'));
                }
            }

            // Exit code
            process.exit(getExitCode(results, options.failOn));
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Error: ${err.message}`));
            if (options.verbose) {
                console.error(err.stack);
            }
            process.exit(1);
        }
    });

function formatMcpTerminal(results: McpAuditResult[]): string {
    if (results.length === 0) {
        return [
            '',
            chalk.yellow('No MCP config files found.'),
            chalk.dim('Checked Claude, Cursor, and local mcp.json discovery paths.'),
            '',
        ].join('\n');
    }

    const lines: string[] = [];
    for (const result of results) {
        lines.push('');
        lines.push(chalk.bold(`PromptSonar v${VERSION} — MCP audit ${chalk.underline(result.filePath)}`));
        lines.push('');

        if (result.findings.length === 0) {
            lines.push(chalk.green('  No MCP findings. Config looks clean.'));
        } else {
            for (const finding of result.findings) {
                const color = finding.severity === 'critical' ? chalk.red : finding.severity === 'high' ? chalk.hex('#FF8C00') : finding.severity === 'medium' ? chalk.yellow : chalk.blue;
                lines.push(`  ${color(finding.severity.toUpperCase().padEnd(10))} ${chalk.bold(finding.rule_id)} ${finding.server ? chalk.dim(`[${finding.server}]`) : ''}`);
                lines.push(`     Path: ${finding.path}`);
                lines.push(`     ${finding.message}`);
                lines.push(`     Fix: ${finding.fix}`);
                lines.push('');
            }
        }

        const statusColor = result.status === 'pass' ? chalk.green : result.status === 'warn' ? chalk.yellow : chalk.red;
        lines.push(statusColor(`Status: ${result.status.toUpperCase()} (${result.findings.length} findings)`));
        lines.push('');
    }

    return lines.join('\n');
}

function formatMcpSarif(results: McpAuditResult[]): string {
    const ruleMap = new Map<string, any>();
    const sarifResults: any[] = [];

    for (const result of results) {
        for (const finding of result.findings) {
            ruleMap.set(finding.rule_id, {
                id: finding.rule_id,
                name: finding.rule_id,
                shortDescription: { text: finding.message },
                help: { text: finding.fix },
            });
            sarifResults.push({
                ruleId: finding.rule_id,
                level: finding.severity === 'critical' || finding.severity === 'high' ? 'error' : finding.severity === 'medium' ? 'warning' : 'note',
                message: { text: `${finding.message} Fix: ${finding.fix}` },
                locations: [{
                    physicalLocation: {
                        artifactLocation: { uri: result.filePath },
                        region: { startLine: 1, startColumn: 1 },
                    },
                }],
            });
        }
    }

    return JSON.stringify({
        version: '2.1.0',
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        runs: [{
            tool: {
                driver: {
                    name: 'PromptSonar MCP Auditor',
                    version: VERSION,
                    informationUri: 'https://github.com/meghal86/promptsonar',
                    rules: Array.from(ruleMap.values()),
                },
            },
            results: sarifResults,
        }],
    }, null, 2);
}

program
    .command('audit-mcp')
    .description('Audit MCP config files for unsafe servers, secrets, and tool poisoning risks')
    .argument('[path]', 'Optional path to claude_desktop_config.json, .cursor/mcp.json, or mcp.json')
    .option('--json', 'Output audit results as JSON')
    .option('--sarif', 'Output audit results as SARIF')
    .option('--output <file>', 'Write audit output to a file')
    .action((targetPath, options) => {
        try {
            const results = auditDiscoveredMcpConfigs(targetPath);
            const output = options.sarif
                ? formatMcpSarif(results)
                : options.json
                    ? JSON.stringify(results, null, 2)
                    : formatMcpTerminal(results);

            if (options.output) {
                fs.writeFileSync(path.resolve(options.output), output, 'utf-8');
                console.log(chalk.green(`Results written to ${options.output}`));
            } else {
                console.log(output);
            }

            process.exit(getMcpExitCode(results));
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] MCP audit error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('sbom')
    .description('Generate a CycloneDX Prompt SBOM for a given directory')
    .argument('<path>', 'Path to file or directory to scan for the SBOM')
    .option('--output <file>', 'Write SBOM results to a JSON file', 'prompt-sbom.json')
    .option('-v, --verbose', 'Show detailed scan information')
    .action(async (targetPath, options) => {
        try {
            console.log(chalk.blue(`[PromptSonar] Scanning ${targetPath} for SBOM generation...`));
            const results = await scanFiles(targetPath, {
                verbose: options.verbose
            });

            const sbomString = generatePromptSBOM(results);
            
            const outputPath = path.resolve(options.output);
            fs.writeFileSync(outputPath, sbomString, 'utf-8');
            console.log(chalk.green(`✅ Prompt SBOM generated at ${outputPath}`));
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] SBOM Error: ${err.message}`));
            if (options.verbose) {
                console.error(err.stack);
            }
            process.exit(1);
        }
    });

program
    .command('export')
    .description('Export an Article 19 compliance logging dump by running a workspace scan')
    .argument('<path>', 'Path to file or directory to scan for the export')
    .option('--format <type>', 'Export format (e.g., article19)', 'article19')
    .option('--output <file>', 'Write export results to a JSONL file')
    .option('-v, --verbose', 'Show detailed scan information')
    .action(async (targetPath, options) => {
        try {
            if (options.verbose) console.log(chalk.blue(`[PromptSonar] Scanning ${targetPath} for Export...`));
            const results = await scanFiles(targetPath, { verbose: options.verbose });
            
            let output: string;
            if (options.format === 'article19') {
                output = formatArticle19(results);
            } else {
                console.error(chalk.red(`[PromptSonar] Unknown export format: ${options.format}`));
                process.exit(1);
            }
            
            if (options.output) {
                const outputPath = path.resolve(options.output);
                fs.writeFileSync(outputPath, output, 'utf-8');
                console.log(chalk.green(`✅ Export generated at ${outputPath}`));
            } else {
                console.log(output);
            }
        } catch(err: any) {
            console.error(chalk.red(`[PromptSonar] Export Error: ${err.message}`));
            if (options.verbose) console.error(err.stack);
            process.exit(1);
        }
    });

program
    .command('compress')
    .description('Optimize and compress a prompt file using LLMLingua-2')
    .argument('<file>', 'Path to prompt text file to compress')
    .option('--write', 'Overwrite the original prompt file with the optimized output')
    .option('--output <file>', 'Save the compressed prompt to a specific output file')
    .option('-v, --verbose', 'Show detailed compression and ROI metrics')
    .action(async (filePath, options) => {
        try {
            const absolutePath = path.resolve(filePath);
            if (!fs.existsSync(absolutePath)) {
                console.error(chalk.red(`[PromptSonar] Error: File does not exist at ${filePath}`));
                process.exit(1);
            }
            
            const promptText = fs.readFileSync(absolutePath, 'utf-8');
            if (options.verbose) {
                console.log(chalk.blue(`[PromptSonar] Compressing ${filePath} (${promptText.length} characters)...`));
            }
            
            const compression = await compressPromptLLMLingua(promptText);
            const roi = calculateROI(compression.originalTokens, compression.compressedTokens);
            
            console.log(chalk.bold.green('\n⚡️ Prompt Compression Completed successfully!'));
            console.log(chalk.cyan(`  Original Tokens:  `) + `${compression.originalTokens}`);
            console.log(chalk.cyan(`  Optimized Tokens: `) + chalk.green(`${compression.compressedTokens}`));
            console.log(chalk.cyan(`  Token Savings:    `) + chalk.bold.green(`-${roi.compressionRatio}`));
            console.log(chalk.cyan(`  ROI Impact:       `) + chalk.green.bold(`$${roi.dollarsSavedPer10kCalls.toFixed(2)} savings per 10k completions\n`));
            
            if (options.write) {
                fs.writeFileSync(absolutePath, compression.compressedText, 'utf-8');
                console.log(chalk.green(`✅ Overwrote original file: ${filePath}`));
            } else if (options.output) {
                const outPath = path.resolve(options.output);
                fs.writeFileSync(outPath, compression.compressedText, 'utf-8');
                console.log(chalk.green(`✅ Optimized prompt written to ${options.output}`));
            } else {
                console.log(chalk.bold.white('Optimized Prompt Output:'));
                console.log(chalk.gray('----------------------------------------'));
                console.log(compression.compressedText);
                console.log(chalk.gray('----------------------------------------'));
                console.log(chalk.dim('\nTo overwrite the file with this optimization, run with --write.'));
            }
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Compression Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('playground')
    .description('Launch the local visual PromptSonar Playground')
    .action(() => {
        const { exec } = require('child_process');
        console.log(chalk.bold.magenta('\n🚀 Launching PromptSonar Interactive Playground...'));
        console.log(chalk.cyan('Opening browser to:'));
        console.log(chalk.green.bold('👉 http://localhost:3000/playground\n'));
        console.log(chalk.dim('Make sure the dashboard server is running (npm run dev).'));
        
        exec('open http://localhost:3000/playground', (err: any) => {
            if (err) {
                console.log(chalk.yellow('Note: Failed to open browser automatically. Please open http://localhost:3000/playground manually.'));
            }
        });
    });

program
    .command('test')
    .description('Run prompt unit tests defined in a JSON test configuration file')
    .argument('[config]', 'Path to the test JSON config file')
    .action(async (configPath) => {
        let selectedPath = configPath;
        if (!selectedPath) {
            if (fs.existsSync(path.resolve('prompts.test.json'))) {
                selectedPath = 'prompts.test.json';
            } else if (fs.existsSync(path.resolve('.prompts.test.json'))) {
                selectedPath = '.prompts.test.json';
            } else {
                selectedPath = 'prompts.test.json';
            }
        }
        await runPromptTests(selectedPath);
    });

program
    .command('init-skill')
    .description('Scaffold a standardized AI Agent Skill directory structure')
    .argument('<name>', 'Name of the skill to create')
    .option('--lang <type>', 'Language for the execution script template (js|ts|py)', 'ts')
    .action((name, options) => {
        const skillDir = path.resolve(name);
        if (fs.existsSync(skillDir)) {
            console.error(chalk.red(`[PromptSonar] Error: Directory "${name}" already exists.`));
            process.exit(1);
        }

        try {
            console.log(chalk.blue(`[PromptSonar] Scaffolding Agent Skill: ${name}...`));

            // Create folders
            fs.mkdirSync(skillDir, { recursive: true });
            fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
            fs.mkdirSync(path.join(skillDir, 'resources'), { recursive: true });

            // Create SKILL.md
            const skillMd = `---
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
description: Standardized agent skill scaffolded by PromptSonar.
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())} Skill

Provide a detailed summary of what this agent skill does, and what task it solves.

## 📋 Instruction Guidelines
Write your precise system instructions and formatting parameters here:
- Enforce structured outputs.
- Specify clear boundaries and constraints.
- Define a solid persona and tone.

## 📥 Inputs & Variables
Define the dynamic variables your prompt uses:
- \`variable_name\`: Description of the expected variable.

## 🧪 Examples & Few-Shot Templates
Provide examples to guide the model's behavior:
\`\`\`
Input: ...
Output: ...
\`\`\`
`;
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMd, 'utf-8');

            // Create script template
            if (options.lang === 'py') {
                const pyScript = `import os
import sys

def run_skill(variables):
    print(f"Running skill '${name}' with variables:", variables)
    # Implement actual model invocation using the templates in resources/
    pass

if __name__ == "__main__":
    run_skill({"input": "test"})
`;
                fs.writeFileSync(path.join(skillDir, 'scripts', 'run.py'), pyScript, 'utf-8');
            } else {
                const jsScript = `/**
 * Executable script template for the ${name} skill.
 */
export async function runSkill(variables) {
    console.log("Running skill '${name}' with variables:", variables);
    // Implement actual model invocation using the templates in resources/
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
    runSkill({ input: "test" });
}
`;
                fs.writeFileSync(path.join(skillDir, 'scripts', 'run.js'), jsScript, 'utf-8');
            }

            // Create a dummy resource prompt
            const basePrompt = `You are a specialized agent executing the ${name} skill.
Instructions:
1. Follow the guidelines in SKILL.md.
2. Accept variables: {{input}}.
`;
            fs.writeFileSync(path.join(skillDir, 'resources', 'prompt.prompt'), basePrompt, 'utf-8');

            console.log(chalk.bold.green(`\n🎉 Success! Agent Skill "${name}" scaffolded completely.`));
            console.log(chalk.cyan(`  Location: `) + `${skillDir}`);
            console.log(chalk.cyan(`  Scaffolded Files:`));
            console.log(`    - ${path.join(name, 'SKILL.md')} (Instruction & Metadata)`);
            console.log(`    - ${path.join(name, 'scripts', options.lang === 'py' ? 'run.py' : 'run.js')} (Execution template)`);
            console.log(`    - ${path.join(name, 'resources', 'prompt.prompt')} (Base prompt template)`);
            console.log(chalk.white(`\nYou can now run 'promptsonar scan ${name}' to test your prompt templates for safety and quality!`));

        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Error scaffolding skill: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('test-contracts')
    .description('Validate a prompt template and dynamic variables against a Prompt Contract')
    .argument('<contract>', 'Path to the contract .prompt.yaml file')
    .requiredOption('--prompt <file>', 'Path to the prompt template file to test')
    .option('--vars <json>', 'JSON string representing dynamic template input variables')
    .action(async (contractPath, options) => {
        try {
            const absoluteContractPath = path.resolve(contractPath);
            const absolutePromptPath = path.resolve(options.prompt);

            if (!fs.existsSync(absoluteContractPath)) {
                console.error(chalk.red(`[PromptSonar] Error: Contract file does not exist at ${contractPath}`));
                process.exit(1);
            }
            if (!fs.existsSync(absolutePromptPath)) {
                console.error(chalk.red(`[PromptSonar] Error: Prompt file does not exist at ${options.prompt}`));
                process.exit(1);
            }

            const contractYaml = fs.readFileSync(absoluteContractPath, 'utf-8');
            const promptText = fs.readFileSync(absolutePromptPath, 'utf-8');

            let vars: Record<string, any> = {};
            if (options.vars) {
                try {
                    vars = JSON.parse(options.vars);
                } catch (err: any) {
                    console.error(chalk.red(`[PromptSonar] Error parsing variables JSON: ${err.message}`));
                    process.exit(1);
                }
            }

            console.log(chalk.blue(`[PromptSonar] Validating ${options.prompt} against contract ${contractPath}...`));
            const result = validatePromptAgainstContract(promptText, contractYaml, vars);

            if (result.passed) {
                console.log(chalk.bold.green(`\n✅ Contract Validation Passed (Contract ID: ${result.contractId})`));
                process.exit(0);
            } else {
                console.error(chalk.bold.red(`\n❌ Contract Validation Failed (Contract ID: ${result.contractId})`));
                result.violations.forEach(v => console.error(chalk.red(`  - ${v}`)));
                process.exit(1);
            }
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Contract Validation Error: ${err.message}`));
            process.exit(1);
        }
    });

program
    .command('eval')
    .description('Perform cross-model safety and structural evaluation on a prompt')
    .argument('<prompt>', 'Path to the prompt file')
    .option('--models <list>', 'Comma-separated list of models to evaluate', 'gpt-4o,claude-3.5')
    .action(async (promptPath, options) => {
        try {
            const absolutePromptPath = path.resolve(promptPath);
            if (!fs.existsSync(absolutePromptPath)) {
                console.error(chalk.red(`[PromptSonar] Error: Prompt file does not exist at ${promptPath}`));
                process.exit(1);
            }

            const promptText = fs.readFileSync(absolutePromptPath, 'utf-8');
            const models = options.models.split(',').map((m: string) => m.trim());

            console.log(chalk.bold.cyan(`\n📊 Evaluating Prompt: ${promptPath} across models: ${models.join(', ')}...\n`));
            
            const summary = await runCrossModelEvaluation(promptText, promptPath, models);

            console.log(chalk.bold.white('----------------------------------------'));
            console.log(chalk.bold.cyan('Cross-Model Evaluation Summary:'));
            console.log(chalk.cyan('  Safety Pass Rate:       ') + (summary.safety_pass_rate >= 80 ? chalk.green.bold(`${summary.safety_pass_rate}%`) : chalk.red.bold(`${summary.safety_pass_rate}%`)));
            console.log(chalk.cyan('  Structure Compliance:   ') + (summary.structure_compliance >= 80 ? chalk.green.bold(`${summary.structure_compliance}%`) : chalk.red.bold(`${summary.structure_compliance}%`)));
            console.log(chalk.cyan('  Regressions Detected:   ') + (summary.regressions_detected ? chalk.bold.red('Yes') : chalk.bold.green('No')));
            console.log(chalk.bold.white('----------------------------------------'));

            console.log(chalk.bold.white('\nModel-by-Model Breakdown:'));
            for (const item of summary.modelBreakdown) {
                console.log(chalk.bold.magenta(`\n🤖 Model: ${item.model}`));
                console.log(chalk.cyan('  Safety Score:   ') + `${item.safetyScore}/100`);
                console.log(chalk.cyan('  Structure Score:') + `${item.structureScore}/100`);
                console.log(chalk.cyan('  Drift Index:    ') + `${item.driftIndex.toFixed(2)}`);
                if (item.regressions.length > 0) {
                    console.log(chalk.red('  Regressions:'));
                    item.regressions.forEach(r => console.error(chalk.red(`    - ${r}`)));
                }
                console.log(chalk.dim('  Output Sample:  ') + chalk.italic.gray(`"${item.outputSample}"`));
            }
            console.log('');

            if (summary.regressions_detected) {
                process.exit(1);
            } else {
                process.exit(0);
            }

        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Cross-Model Evaluation Error: ${err.message}`));
            process.exit(1);
        }
    });

program.parse();
