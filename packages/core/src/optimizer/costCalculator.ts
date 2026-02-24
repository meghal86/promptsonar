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
export function calculateROI(originalTokens: number, compressedTokens: number): CostSavingsROI {
    const tokensSaved = Math.max(0, originalTokens - compressedTokens);

    // Average premium LLM Cost (e.g. GPT-4 Turbo / Claude 3 Opus rough blended input token cost)
    // $5.00 per 1M tokens == $0.005 per 1k tokens
    const costPer1kTokens = 0.005;

    // Dollar savings per 10,000 invocations of this prompt
    const savedPerCall = (tokensSaved / 1000) * costPer1kTokens;
    const dollarsSavedPer10kCalls = parseFloat((savedPerCall * 10000).toFixed(2));

    const ratio = originalTokens > 0
        ? ((compressedTokens / originalTokens) * 100).toFixed(1) + "%"
        : "100%";

    return {
        originalTokens,
        newTokens: compressedTokens,
        tokensSaved,
        compressionRatio: ratio,
        dollarsSavedPer10kCalls
    };
}
