import { RuleResult } from '../rules';
/**
 * Generates a standalone HTML report based on the scan results.
 * This matches the visual style of the PromptSonar VS Code Extension dashboard.
 */
export declare function generateHtmlReport(result: RuleResult, promptText: string, roiHtml?: string): string;
