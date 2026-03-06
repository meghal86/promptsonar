interface ScanResult {
    filePath: string;
    overall_score: number;
    status: 'pass' | 'warn' | 'fail';
    pillar_scores: Record<string, number>;
    findings_count: number;
    findings: ScanFinding[];
}
interface ScanFinding {
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
declare function scanFiles(targetPath: string, options: {
    verbose?: boolean;
    diffOnly?: boolean;
    waiverFile?: string;
}): Promise<ScanResult[]>;
declare function generateSarif(results: ScanResult[]): string;

/**
 * Formats scan results as a JSON string matching the exact FRD v5.0 output shape.
 */
declare function formatJson(results: ScanResult[]): string;
/**
 * Formats scan results as the exact terminal output matching the FRD v5.0 spec.
 */
declare function formatTerminal(results: ScanResult[]): string;
/**
 * Determines the exit code based on findings severity and the --fail-on threshold.
 * Returns: 0 = clean, 1 = critical, 2 = high (no criticals), 3 = medium (no criticals/highs)
 */
declare function getExitCode(results: ScanResult[], failOn: string): number;

export { type ScanFinding, type ScanResult, formatJson, formatTerminal, generateSarif, getExitCode, scanFiles };
