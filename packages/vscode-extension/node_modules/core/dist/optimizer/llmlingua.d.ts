export interface CompressionResult {
    originalText: string;
    compressedText: string;
    originalTokens: number;
    compressedTokens: number;
    compressionRatio: string;
}
/**
 * Spawns a local Python process to run LLMLingua-2 for token compression.
 * Note: This requires the `llmlingua` python package to be globally installed (`pip install llmlingua`).
 * Target: 20% minimum token reduction.
 */
export declare function compressPromptLLMLingua(promptText: string): Promise<CompressionResult>;
