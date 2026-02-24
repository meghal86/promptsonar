import { RuleInput, RuleResult } from './types';
import { checkVagueWords } from './clarity/vague_words';
import { checkOwaspPatterns } from './security/owasp_patterns';
import { checkPii } from './security/pii';
import { checkTokenLimit } from './efficiency/token_limit';
import { checkJsonMode } from './structure/json_mode';
import { checkContradictions } from './consistency/contradictions';

export * from './types';

export function evaluatePrompt(input: RuleInput, config: any = {}): RuleResult {
    const findings = [
        ...checkVagueWords(input),
        ...checkOwaspPatterns(input),
        ...checkPii(input),
        ...checkTokenLimit(input, config?.efficiency?.token_budget || 8192),
        ...checkJsonMode(input),
        ...checkContradictions(input)
    ];

    // Scoring weights: clarity: 25%, security: 30%, efficiency: 20%, structure: 15%, consistency: 10%
    // Instead of dynamic weights per finding, we will sum the penalty_scores and deduct from 100.
    // The system prompt logic: "deterministic weighted sum ONLY (no LLM randomness): clarity: 25%, security: 30%, ... Final score = 100 - sum(penalties), clamped 0-100"

    let totalPenalty = 0;
    for (const finding of findings) {
        if (finding.category === 'clarity') totalPenalty += (finding.penalty_score || 0) * 0.25;
        if (finding.category === 'security') totalPenalty += (finding.penalty_score || 0) * 0.30;
        if (finding.category === 'efficiency') totalPenalty += (finding.penalty_score || 0) * 0.20;
        if (finding.category === 'structure') totalPenalty += (finding.penalty_score || 0) * 0.15;
        if (finding.category === 'consistency') totalPenalty += (finding.penalty_score || 0) * 0.10;
    }

    // Wait, if it's "100 - sum(penalties)", maybe penalties are raw points and the categories define max points?
    // Let's just deduct raw penalty sums since rules define their own penalty.
    // We'll scale them by weights to honor the "weighted sum" requirement.
    const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

    // Thresholds: pass >=85, warn 70-84, fail <70
    let status: "pass" | "warn" | "fail" = "pass";
    if (score < 70) {
        status = "fail";
    } else if (score < 85) {
        status = "warn";
    }

    // Strip internal fields like penalty_score from output
    const cleanFindings = findings.map(f => {
        const { penalty_score, ...rest } = f;
        return rest;
    });

    return {
        score,
        status,
        findings: cleanFindings as any
    };
}
