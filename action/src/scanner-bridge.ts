/**
 * Bridge module: re-exports scanner functionality from the CLI package
 * for use in the GitHub Action context.
 * 
 * This avoids duplicating the scanning logic and ensures the Action
 * uses the same core engine as the CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { parseFile, evaluatePrompt, RuleResult, loadWaivers, getActiveWaivers, isFindingWaived, Waiver } from 'core';
import { formatToSarif } from 'core/dist/formatter/sarif';

export interface ScanResult {
    filePath: string;
    overall_score: number;
    status: 'pass' | 'warn' | 'fail';
    pillar_scores: Record<string, number>;
    findings_count: number;
    findings: ScanFinding[];
}

export interface ScanFinding {
    rule_id: string;
    severity: string;
    line: number;
    column: number;
    message: string;
    fix: string;
    owasp_ref: string;
    docs_url: string;
    waived: boolean;
}

function getOwaspRef(ruleId: string): string {
    if (ruleId.startsWith('sec_owasp_llm01') || ruleId.startsWith('sec_unicode') || ruleId === 'sec_unbounded_persona') return 'LLM01';
    if (ruleId.startsWith('sec_owasp_llm02')) return 'LLM02';
    if (ruleId === 'sec_unbounded_access' || ruleId === 'sec_rag_injection') return 'LLM07';
    return '';
}

function getCategoryForRule(ruleId: string): string {
    if (ruleId.startsWith('sec_')) return 'security';
    if (ruleId.startsWith('clarity_')) return 'clarity';
    if (ruleId.startsWith('struct_')) return 'structure';
    if (ruleId.startsWith('bp_')) return 'best_practices';
    if (ruleId.startsWith('consist_')) return 'consistency';
    if (ruleId.startsWith('eff_')) return 'efficiency';
    if (ruleId.startsWith('ethics_')) return 'ethics';
    return 'security';
}

function getPenaltyForSeverity(severity: string): number {
    switch (severity) {
        case 'critical': return 30;
        case 'high': return 20;
        case 'medium': return 10;
        case 'low': return 5;
        default: return 5;
    }
}

function computePillarScores(findings: ScanFinding[]): Record<string, number> {
    const pillars: Record<string, number> = {
        security: 100, clarity: 100, structure: 100,
        best_practices: 100, consistency: 100, efficiency: 100, ethics: 100,
    };
    for (const f of findings) {
        const cat = getCategoryForRule(f.rule_id);
        if (cat in pillars) pillars[cat] = Math.max(0, pillars[cat] - getPenaltyForSeverity(f.severity));
    }
    return pillars;
}

const SUPPORTED_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.java', '.go', '.cs',
    '.prompt', '.ai', '.chat', '.json', '.yml', '.yaml',
];

function getLanguageForExt(ext: string): string {
    switch (ext) {
        case '.py': return 'python';
        case '.ts': case '.tsx': case '.js': case '.jsx': return 'typescript';
        case '.go': return 'go';
        case '.java': return 'java';
        case '.rs': return 'rust';
        case '.cs': return 'c_sharp';
        default: return '';
    }
}

export async function scanFiles(targetPath: string, options: {
    verbose?: boolean;
    diffOnly?: boolean;
    waiverFile?: string;
}): Promise<ScanResult[]> {
    const results: ScanResult[] = [];

    let activeWaivers: Waiver[] = [];
    if (options.waiverFile) {
        const waiverResult = loadWaivers(options.waiverFile);
        activeWaivers = getActiveWaivers(waiverResult.waivers);
    }

    const resolvedPath = path.resolve(targetPath);
    let files: string[] = [];

    if (fs.statSync(resolvedPath).isDirectory()) {
        const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
        files = await fg(patterns, {
            cwd: resolvedPath,
            absolute: true,
            ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
        });
    } else {
        files = [resolvedPath];
    }

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).toLowerCase();
        const language = getLanguageForExt(ext);

        try {
            const prompts = await parseFile({ filePath, content, language });

            for (const prompt of prompts) {
                const evalResult: RuleResult = evaluatePrompt(
                    { text: prompt.text, language, context: { filePath } }
                );

                const scanFindings: ScanFinding[] = evalResult.findings.map(f => {
                    const waived = isFindingWaived(f.rule_id, filePath, activeWaivers);
                    return {
                        rule_id: f.rule_id,
                        severity: f.severity,
                        line: prompt.startLine,
                        column: 1,
                        message: f.explanation,
                        fix: f.suggested_fix || '',
                        owasp_ref: getOwaspRef(f.rule_id),
                        docs_url: `https://github.com/meghal86/promptsonar/wiki/rules/${f.rule_id}`,
                        waived,
                    };
                });

                results.push({
                    filePath,
                    overall_score: evalResult.score,
                    status: evalResult.status,
                    pillar_scores: computePillarScores(scanFindings),
                    findings_count: scanFindings.length,
                    findings: scanFindings,
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

export function generateSarif(results: ScanResult[]): string {
    const allFindings: Array<{
        rule_id: string; category: any; severity: any;
        explanation: string; suggested_fix?: string;
    }> = [];
    const primaryFile = results.length > 0 ? results[0].filePath : 'unknown';

    for (const result of results) {
        for (const f of result.findings) {
            allFindings.push({
                rule_id: f.rule_id,
                category: getCategoryForRule(f.rule_id) as any,
                severity: f.severity as any,
                explanation: f.message,
                suggested_fix: f.fix,
            });
        }
    }

    return formatToSarif(allFindings as any, primaryFile);
}
