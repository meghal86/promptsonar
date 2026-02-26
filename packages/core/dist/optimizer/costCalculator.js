"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateROI = calculateROI;
/**
 * Calculates ROI cost savings for prompt token compression.
 * @param originalTokens Total input tokens before compression.
 * @param compressedTokens Total input tokens after LLMLingua-2 compression.
 * @returns CostSavingsROI object containing the estimated dollar impact.
 */
function calculateROI(originalTokens, compressedTokens) {
    const tokensSaved = Math.max(0, originalTokens - compressedTokens);
    // Average premium LLM Cost (e.g. GPT-4 Turbo / Claude 3 Opus rough blended input token cost)
    // $5.00 per 1M tokens == $0.005 per 1k tokens
    const costPer1kTokens = 0.005;
    // Dollar savings per 10,000 invocations of this prompt
    const savedPerCall = (tokensSaved / 1000) * costPer1kTokens;
    let dollarsSavedPer10kCalls = parseFloat((savedPerCall * 10000).toFixed(2));
    if (dollarsSavedPer10kCalls === 0)
        dollarsSavedPer10kCalls = 0.00; // Force exact number
    let ratio = "0.0%";
    if (originalTokens > 0) {
        if (compressedTokens === originalTokens || compressedTokens === 0) {
            ratio = "0.0%";
        }
        else {
            ratio = ((compressedTokens / originalTokens) * 100).toFixed(1) + "%";
        }
    }
    return {
        originalTokens,
        newTokens: compressedTokens,
        tokensSaved,
        compressionRatio: ratio,
        dollarsSavedPer10kCalls
    };
}
