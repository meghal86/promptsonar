#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { scanFiles, generateSarif } from './scanner';
import { formatJson, formatTerminal, getExitCode } from './formatters';
import { generateHtmlReport, calculateROI, compressPromptLLMLingua } from 'core';

const VERSION = '1.0.23';

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
                        category: (f as any).category || 'security',
                        explanation: f.message,
                        suggested_fix: f.fix,
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

program.parse();
