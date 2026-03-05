#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import chalk from 'chalk';
import { scanFiles, generateSarif } from './scanner';
import { formatJson, formatTerminal, getExitCode } from './formatters';

const VERSION = '0.1.0';

const program = new Command();

program
    .name('promptsonar')
    .description('PromptSonar — Static security scanner for LLM prompts')
    .version(VERSION);

program
    .command('scan')
    .description('Scan files or directories for LLM prompt security issues')
    .argument('<path>', 'File or directory to scan')
    .option('--json', 'Output results as JSON')
    .option('--sarif', 'Output results as SARIF v2.1.0')
    .option('--output <file>', 'Write output to a file instead of stdout')
    .option('--fail-on <severity>', 'Exit code threshold: critical|high|medium|none', 'critical')
    .option('--waiver-file <file>', 'Path to .promptsonar-waivers.yaml', '.promptsonar-waivers.yaml')
    .option('--diff-only', 'Scan changed files only (git diff)')
    .option('--verbose', 'Show verbose output including skipped files')
    .action(async (targetPath: string, opts: any) => {
        try {
            // Diff-only stub
            if (opts.diffOnly) {
                console.warn(chalk.yellow('[PromptSonar] --diff-only is not yet implemented. Scanning all files.'));
            }

            // Run the scan
            const results = await scanFiles(targetPath, {
                verbose: opts.verbose,
                diffOnly: opts.diffOnly,
                waiverFile: opts.waiverFile,
            });

            // Format output
            let output: string;

            if (opts.sarif) {
                output = generateSarif(results);
            } else if (opts.json) {
                output = formatJson(results);
            } else {
                output = formatTerminal(results);
            }

            // Write or print
            if (opts.output) {
                fs.writeFileSync(opts.output, output, 'utf-8');
                console.log(chalk.green(`✅ Results written to ${opts.output}`));
            } else {
                console.log(output);
            }

            // Exit code
            const exitCode = getExitCode(results, opts.failOn);
            if (exitCode !== 0) {
                process.exit(exitCode);
            }
        } catch (err: any) {
            console.error(chalk.red(`[PromptSonar] Error: ${err.message}`));
            if (opts.verbose) {
                console.error(err.stack);
            }
            process.exit(1);
        }
    });

program.parse();
