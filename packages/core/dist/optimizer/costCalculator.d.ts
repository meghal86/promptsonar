export interface CostSavingsROI {
    originalTokens: number;
    newTokens: number;
    tokensSaved: number;
    compressionRatio: string;
    dollarsSavedPer10kCalls: number;
}
/**
 * Calculates ROI cost savings for prompt token compression.
 * @param originalTokens Total input tokens before compression.
 * @param compressedTokens Total input tokens after LLMLingua-2 compression.
 * @returns CostSavingsROI object containing the estimated dollar impact.
 */
export declare function calculateROI(originalTokens: number, compressedTokens: number): CostSavingsROI;
