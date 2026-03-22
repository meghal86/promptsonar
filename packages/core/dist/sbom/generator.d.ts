export interface ScanResultInput {
    filePath: string;
    overall_score?: number;
    score?: number;
    findings?: any[];
}
/**
 * Generates a CycloneDX v1.4 compatible AI Prompt SBOM from promptsonar scan results.
 */
export declare function generatePromptSBOM(results: ScanResultInput[], projectName?: string): string;
