import chalk from 'chalk';
import { analyzeRootCause, contextualVerdictLabel, humanRuleName } from '@promptsonar/core';
import { ScanResult } from './scanner';

const VERSION = '1.4.3';

// Severity color/emoji map
const SEVERITY_DISPLAY: Record<string, { emoji: string; color: (s: string) => string; label: string }> = {
    critical: { emoji: '🔴', color: chalk.red, label: 'CRITICAL' },
    high: { emoji: '🟠', color: chalk.hex('#FF8C00'), label: 'HIGH' },
    medium: { emoji: '🟡', color: chalk.yellow, label: 'MEDIUM' },
    low: { emoji: '🔵', color: chalk.blue, label: 'LOW' },
};

function shouldShowWorkflow(severity: string): boolean {
    return severity === 'high' || severity === 'critical';
}

function formatWorkflowPath(finding: ScanResult['findings'][number]): string[] {
    const workflow = finding.workflow as any;
    if (!workflow || !shouldShowWorkflow(finding.severity)) return [];

    const lines = ['     AI Workflow Path:'];
    workflow.path.nodes.forEach((node: any, index: number) => {
        const prefix = index === 0 ? '       ' : '         -> ';
        const trust = node.trust === 'unknown' ? '' : ` (${node.trust})`;
        lines.push(`${prefix}${node.type}${trust}`);
    });

    // Execution Path Confidence (deterministic provenance score).
    if (typeof workflow.confidence_score === 'number') {
        const level = workflow.confidence_level ? ` (${workflow.confidence_level})` : '';
        lines.push(`     Execution Path Confidence: ${workflow.confidence_score}%${level}`);
    }

    lines.push('     Risk:');
    lines.push(`       ${workflow.path.summary.replace(/_/g, ' ')} is a ${workflow.risk} workflow path.`);

    // Workflow Diff (remediation before/after).
    const diff = workflow.workflow_diff;
    if (diff) {
        lines.push('     Workflow Diff:');
        if (diff.executionPathRemoved) {
            lines.push(chalk.green('       ✓ Execution Path Removed'));
        } else {
            lines.push(chalk.yellow(`       ⚠ Path not fully removed (${diff.diffReason})`));
        }
        lines.push(`       Risk Reduction: ${diff.riskReduction}% (${diff.beforeRisk} -> ${diff.afterRisk})`);
        if (Array.isArray(diff.removedNodes) && diff.removedNodes.length > 0) {
            lines.push(`       Removed Nodes: ${diff.removedNodes.map((n: string) => n.replace(/_/g, ' ')).join(', ')}`);
        }
    }

    lines.push('     Recommendation:');
    lines.push(`       ${workflow.recommendation}`);
    return lines;
}

/**
 * Root Cause Analysis block for a single scanned file: the finding that best
 * explains the cluster, plus the related findings describing the same issue.
 * Deterministic — no findings are deleted or suppressed.
 */
function formatRootCause(result: ScanResult): string[] {
    const analysis = analyzeRootCause(result.findings as any);
    if (!analysis) return [];

    const lines: string[] = [];
    lines.push(chalk.bold('  Root Cause:'));
    lines.push(`     ${humanRuleName(analysis.rootCause.rule_id)}`);
    if (analysis.supportingFindings.length > 0) {
        lines.push('  Supporting:');
        for (const sf of analysis.supportingFindings) {
            lines.push(`     - ${humanRuleName(sf.rule_id)}`);
        }
    }
    lines.push('');
    return lines;
}

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
        executive_summary: r.executive_summary,
        findings_count: r.findings_count,
        total_findings_count: r.total_findings_count ?? r.findings_count,
        unique_findings_count: r.unique_findings_count ?? r.findings_count,
        repeated_findings_count: r.repeated_findings_count ?? 0,
        summarized_findings_count: r.summarized_findings_count ?? 0,
        scan_summary: r.scan_summary,
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
    const DISPLAY_LIMIT = 200;
    let displayedFindingCount = 0;
    let hiddenByTerminalLimit = 0;

    const summary = results.find(result => result.scan_summary)?.scan_summary;
    if (summary) {
        lines.push('');
        lines.push(chalk.bold(`PromptSonar v${VERSION}`) + ' — workspace summary');
        lines.push(`  Files scanned: ${summary.files_scanned}`);
        lines.push(`  Files skipped: ${summary.files_skipped}`);
        if (Object.keys(summary.skipped_reasons).length > 0) {
            lines.push(`  Skipped reasons: ${Object.entries(summary.skipped_reasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
        }
        lines.push(`  Findings: ${summary.findings_unique} unique${summary.findings_repeated > 0 ? `, ${summary.findings_repeated} repeated instances collapsed` : ''}`);
        if (summary.findings_summarized > 0) {
            lines.push(`  Summary cap: ${summary.findings_summarized} lower-priority findings summarized`);
        }
    }

    for (const result of results) {
        lines.push('');
        lines.push(chalk.bold(`PromptSonar v${VERSION}`) + ` — scanning ${chalk.underline(result.filePath)}`);
        if (result.executive_summary) {
            const summary = result.executive_summary;
            lines.push(`  Overall Risk: ${summary.overall_risk}`);
            lines.push(`  Finding Counts: ${Object.entries(summary.finding_counts).map(([severity, count]) => `${severity}=${count}`).join(', ') || 'none'}`);
            lines.push(`  Highest Priority: ${summary.highest_priority_findings.map(finding => `${finding.rule_id}@${finding.line}`).join(', ') || 'none'}`);
            lines.push(`  Estimated Fix Effort: ${summary.estimated_fix_effort}`);
        }
        lines.push('');

        if (result.findings.length === 0) {
            lines.push(chalk.green('  ✅ No findings. Prompt looks clean!'));
        } else {
            for (const f of result.findings) {
                const mustShow = f.severity === 'critical' || f.severity === 'high';
                if (!mustShow && displayedFindingCount >= DISPLAY_LIMIT) {
                    hiddenByTerminalLimit++;
                    continue;
                }
                displayedFindingCount++;
                const sev = SEVERITY_DISPLAY[f.severity] || SEVERITY_DISPLAY.low;
                const repeatLabel = (f.instance_count || 1) > 1 ? `  (${f.instance_count} instances)` : '';
                if (f.waived) {
                    // Waived findings: dimmed with [WAIVED] tag
                    lines.push(chalk.dim(`  ⚠️  ${sev.label.padEnd(10)} ${f.rule_id}${repeatLabel}  [WAIVED]`));
                    lines.push(chalk.dim(`     Line ${f.line}:${f.column} — ${f.message}`));
                    if (f.suppression_reason) {
                        lines.push(chalk.dim(`     Suppression: ${f.suppression_reason}`));
                    }
                } else {
                    lines.push(`  ${sev.emoji} ${sev.color(sev.label.padEnd(10))} ${chalk.bold(f.rule_id)}${repeatLabel}`);
                    lines.push(`     Line ${f.line}:${f.column} — ${f.message}`);
                    if (f.evidence) {
                        lines.push(`     Evidence: ${f.evidence}`);
                    }
                    if (f.risk) {
                        lines.push(`     Risk: ${f.risk}`);
                    }
                    if (f.context?.verdict) {
                        lines.push(`     Verdict: ${contextualVerdictLabel(f.context.verdict)}`);
                    }
                    if (f.fix) {
                        lines.push(`     Fix: ${f.fix}`);
                    }
                    lines.push(...formatWorkflowPath(f));
                    if (f.owasp || f.confidence) {
                        lines.push(`     Metadata: ${[f.owasp ? `OWASP ${f.owasp}` : '', f.confidence ? `Confidence ${f.confidence}` : ''].filter(Boolean).join(' · ')}`);
                    }
                }
                lines.push('');
            }

            // Root Cause Analysis (groups related findings; organization only).
            lines.push(...formatRootCause(result));
            if ((result.summarized_findings_count || 0) > 0) {
                lines.push(`  Showing top findings for this file. ${result.summarized_findings_count} additional lower-priority finding${result.summarized_findings_count === 1 ? '' : 's'} summarized.`);
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
        const repeatText = (result.repeated_findings_count || 0) > 0 ? `, ${result.repeated_findings_count} repeated collapsed` : '';
        const summarizedText = (result.summarized_findings_count || 0) > 0 ? `, ${result.summarized_findings_count} summarized` : '';
        const countStr = countParts.length > 0 ? ` (${result.findings_count} unique findings: ${countParts.join(', ')}${repeatText}${summarizedText})` : '';

        lines.push(statusColor(`Score: ${result.overall_score}/100 ${statusIcon}`) + countStr);
        lines.push('');
    }

    if (hiddenByTerminalLimit > 0) {
        lines.push(`Showing top ${DISPLAY_LIMIT} non-critical/high findings. ${hiddenByTerminalLimit} additional low-priority finding${hiddenByTerminalLimit === 1 ? '' : 's'} summarized in terminal output.`);
        lines.push('Use --json or --sarif for the complete machine-readable result.');
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
    if (hasCritical && failOnIndex >= 0) return 1;
    if (hasHigh && failOnIndex >= 1) return 2;
    if (hasMedium && failOnIndex >= 2) return 3;

    return 0;
}

import * as crypto from 'crypto';

/**
 * Formats scan results into the Article 19 JSONL export schema.
 */
export function formatArticle19(results: ScanResult[]): string {
    const lines: string[] = [];

    for (const r of results) {
        // Create a stable prompt_id from the file path
        const prompt_id = crypto.createHash('sha256').update(r.filePath).digest('hex').substring(0, 12);
        
        // Map OWASP rules into controls
        const controls = new Set<string>();
        controls.add("ISO42001-6.2"); // Default standard compliance tag
        for (const f of r.findings) {
            if (f.owasp_ref) {
                controls.add(`OWASP-${f.owasp_ref}`);
            }
        }

        const logEntry = {
            ts: new Date().toISOString(),
            prompt_id: prompt_id,
            model: "static-analysis", // Placeholder since we don't execute against a live model
            risk_score: Math.max(0, 100 - r.overall_score),
            controls: Array.from(controls),
            outcome: r.status === 'fail' ? 'blocked' : 'success'
        };

        lines.push(JSON.stringify(logEntry));
    }

    return lines.join('\n');
}
