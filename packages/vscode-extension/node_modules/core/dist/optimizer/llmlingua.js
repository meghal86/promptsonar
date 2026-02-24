"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressPromptLLMLingua = compressPromptLLMLingua;
const child_process_1 = require("child_process");
/**
 * Spawns a local Python process to run LLMLingua-2 for token compression.
 * Note: This requires the `llmlingua` python package to be globally installed (`pip install llmlingua`).
 * Target: 20% minimum token reduction.
 */
async function compressPromptLLMLingua(promptText) {
    return new Promise((resolve, reject) => {
        // We use a small inline python script to consume the text via stdin and output JSON
        const pythonScript = `
import sys
import json
try:
    from llmlingua import PromptCompressor
except ImportError:
    print(json.dumps({"error": "llmlingua not installed. Run 'pip install llmlingua'"}))
    sys.exit(1)

text = sys.stdin.read()

# Initialize LLMLingua-2 model (uses a smaller, faster model by default if specified)
# For performance, usually one initializes this once, but for the CLI tool we boot it up per run.
try:
    compressor = PromptCompressor(
        model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank", 
        use_llmlingua2=True
    )
    results = compressor.compress_prompt(text, target_token=int(len(text.split()) * 0.8)) # target 20% reduction min
    
    print(json.dumps({
        "originalText": text,
        "compressedText": results['compressed_prompt'],
        "originalTokens": results['origin_tokens'],
        "compressedTokens": results['compressed_tokens'],
        "compressionRatio": results['ratio']
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
        `;
        const pyProcess = (0, child_process_1.spawn)('python3', ['-c', pythonScript]);
        let outputData = '';
        let errorData = '';
        pyProcess.stdout.on('data', (data) => {
            outputData += data.toString();
        });
        pyProcess.stderr.on('data', (data) => {
            errorData += data.toString();
        });
        pyProcess.on('close', (code) => {
            if (code !== 0) {
                // Return a mock result if python/llmlingua is not properly configured on the system yet
                // so the extension Webview UI can still gracefully display ROI metrics simulated.
                const simulatedRatio = 0.78; // ~22% token reduction
                const mockTokens = Math.max(1, Math.round(promptText.length / 4)); // ~4 chars per token
                const mockCompressed = Math.max(1, Math.round(mockTokens * simulatedRatio));
                resolve({
                    originalText: promptText,
                    compressedText: promptText.substring(0, Math.floor(promptText.length * simulatedRatio)) + "... [LLMLingua SIMULATION]",
                    originalTokens: mockTokens,
                    compressedTokens: mockCompressed,
                    compressionRatio: "(Simulated 22%)",
                });
            }
            else {
                try {
                    const parsed = JSON.parse(outputData.trim());
                    if (parsed.error) {
                        throw new Error(parsed.error);
                    }
                    resolve({
                        originalText: parsed.originalText,
                        compressedText: parsed.compressedText,
                        originalTokens: parsed.originalTokens,
                        compressedTokens: parsed.compressedTokens,
                        compressionRatio: parsed.compressionRatio
                    });
                }
                catch (e) {
                    reject(new Error("Failed to parse LLMLingua output: " + String(e)));
                }
            }
        });
        // Write the prompt to stdin and close
        pyProcess.stdin.write(promptText);
        pyProcess.stdin.end();
    });
}
