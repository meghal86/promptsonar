import chalk from 'chalk';
import { ScanResult } from './scanner';

const VERSION = '1.0.23';

// Severity color/emoji map
const SEVERITY_DISPLAY: Record<string, { emoji: string; color: (s: string) => string; label: string }> = {
    critical: { emoji: '🔴', color: chalk.red, label: 'CRITICAL' },
    high: { emoji: '🟠', color: chalk.hex('#FF8C00'), label: 'HIGH' },
    medium: { emoji: '🟡', color: chalk.yellow, label: 'MEDIUM' },
    low: { emoji: '🔵', color: chalk.blue, label: 'LOW' },
};

/**
 * Formats scan results as a JSON string matching the exact FRD v5.0 output shape.
 */
export function formatJson(results: ScanResult[]): string {
    const output = results.map(r => ({
        version: VERSION,
        scanned_at: new Date().toISOString(),
        file: r.filePath,
        overall_score: r.overall_score,
        status: r.status,
        pillar_scores: r.pillar_scores,
        findings_count: r.findings_count,
        findings: r.findings,
    }));

    // If single file, return the object directly; otherwise array
    if (output.length === 1) {
        return JSON.stringify(output[0], null, 2);
    }
    return JSON.stringify(output, null, 2);
}

/**
 * Formats scan results as the exact terminal output matching the FRD v5.0 spec.
 */
export function formatTerminal(results: ScanResult[]): string {
    const lines: string[] = [];

    for (const result of results) {
        lines.push('');
        lines.push(chalk.bold(`PromptSonar v${VERSION}`) + ` — scanning ${chalk.underline(result.filePath)}`);
        lines.push('');

        if (result.findings.length === 0) {
            lines.push(chalk.green('  ✅ No findings. Prompt looks clean!'));
        } else {
            for (const f of result.findings) {
                const sev = SEVERITY_DISPLAY[f.severity] || SEVERITY_DISPLAY.low;
                if (f.waived) {
                    // Waived findings: dimmed with [WAIVED] tag
                    lines.push(chalk.dim(`  ⚠️  ${sev.label.padEnd(10)} ${f.rule_id}  [WAIVED]`));
                    lines.push(chalk.dim(`     Line ${f.line}:${f.column} — ${f.message}`));
                } else {
                    lines.push(`  ${sev.emoji} ${sev.color(sev.label.padEnd(10))} ${chalk.bold(f.rule_id)}`);
                    lines.push(`     Line ${f.line}:${f.column} — ${f.message}`);
                    if (f.fix) {
                        lines.push(`     Fix: ${f.fix}`);
                    }
                }
                lines.push('');
            }
        }

        // Summary line
        const statusIcon = result.status === 'pass' ? '✅ PASS' : result.status === 'warn' ? '⚠️  WARN' : '❌ FAIL';
        const statusColor = result.status === 'pass' ? chalk.green : result.status === 'warn' ? chalk.yellow : chalk.red;

        const severityCounts: Record<string, number> = {};
        for (const f of result.findings) {
            severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
        }
        const countParts = Object.entries(severityCounts).map(([sev, count]) => `${count} ${sev}`);
        const countStr = countParts.length > 0 ? ` (${result.findings_count} findings: ${countParts.join(', ')})` : '';

        lines.push(statusColor(`Score: ${result.overall_score}/100 ${statusIcon}`) + countStr);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Determines the exit code based on findings severity and the --fail-on threshold.
 * Returns: 0 = clean, 1 = critical, 2 = high (no criticals), 3 = medium (no criticals/highs)
 */
export function getExitCode(results: ScanResult[], failOn: string): number {
    const severityOrder = ['critical', 'high', 'medium', 'low', 'none'];
    const failOnIndex = severityOrder.indexOf(failOn);

    if (failOn === 'none' || failOnIndex === -1) return 0;

    let hasCritical = false;
    let hasHigh = false;
    let hasMedium = false;

    for (const result of results) {
        for (const f of result.findings) {
            if (f.waived) continue; // waived findings don't count
            if (f.severity === 'critical') hasCritical = true;
            if (f.severity === 'high') hasHigh = true;
            if (f.severity === 'medium') hasMedium = true;
        }
    }

    // Return the most severe exit code at or above the threshold
    if (hasCritical && failOnIndex <= 0) return 1;
    if (hasHigh && failOnIndex <= 1) return 2;
    if (hasMedium && failOnIndex <= 2) return 3;

    return 0;
}
