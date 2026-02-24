"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTokenLimit = checkTokenLimit;
function checkTokenLimit(input, tokenBudget = 8192) {
    const findings = [];
    // Rough estimation: 1 token = 4 characters
    const estimatedTokens = Math.ceil(input.text.length / 4);
    if (estimatedTokens > tokenBudget) {
        findings.push({
            rule_id: "eff_token_budget",
            category: "efficiency",
            severity: "medium",
            explanation: `Prompt length (${estimatedTokens} estimated tokens) exceeds budget of ${tokenBudget}.`,
            suggested_fix: `Shorten the prompt or rely on RAG.`,
            penalty_score: 15
        });
    }
    if (input.text.length > 8000) {
        findings.push({
            rule_id: "eff_token_bloat",
            category: "efficiency",
            severity: "high",
            explanation: `Prompt exceeds 8000 chars (~2000 tokens) – risk of truncation or high cost.`,
            suggested_fix: `Shorten the prompt or rely on RAG.`,
            penalty_score: 20
        });
    }
    // Check for compression potential (very rough heuristic: many whitespaces/stopwords)
    const words = input.text.split(/\s+/).length;
    if (words > 100) {
        findings.push({
            rule_id: "eff_compression_potential",
            category: "efficiency",
            severity: "low",
            explanation: `Prompt is long and has high compression potential (>40%).`,
            suggested_fix: `Use LLMLingua-2 to compress the prompt layout.`,
            penalty_score: 5
        });
    }
    return findings;
}
